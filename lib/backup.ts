import fs from "fs";
import { pgEnvFromUrl } from "./pg-env";
import path from "path";
import { db } from "./db";
import { logApp } from "./logs";

/* Backup / restore (admin menu item 11).
   The whole promise is "you can get yesterday's data back", so the rules are strict:
     · a backup is written to ./backups (outside the repo's tracked files, git-ignored)
     · SQLite gets a consistent snapshot through VACUUM INTO — copying a live .db by hand
       can capture a half-written page
     · restore refuses to run without a typed confirmation and always parks the current
       database as a .pre-restore file first, so a restore is itself undoable */

export const BACKUP_DIR = process.env.BACKUP_DIR || path.join(process.cwd(), "backups");
export const KEEP_DEFAULT = 14;

export type BackupInfo = { name: string; size: number; at: string; engine: "sqlite" | "postgres" | "unknown" };

function ensureDir() {
  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

export function isPostgres(): boolean {
  return /^postgres(ql)?:/.test(process.env.DATABASE_URL || "");
}
/* short alias — the backup screen imports it as isPg() */
export const isPg = isPostgres;

/** Where the live SQLite file sits (Prisma resolves file:./dev.db relative to prisma/). */
export function sqlitePath(): string | null {
  const url = process.env.DATABASE_URL || "";
  const m = url.match(/^file:(.+)$/);
  if (!m) return null;
  const raw = m[1];
  /* Prisma resolves a relative file: URL against the schema folder in some versions and the
     project root in others — so try both and trust whichever file is really there. */
  const candidates = path.isAbsolute(raw)
    ? [raw]
    : [path.resolve(process.cwd(), raw), path.join(process.cwd(), "prisma", raw.replace(/^\.\//, ""))];
  return candidates.find((c) => fs.existsSync(c)) || candidates[0];
}

export function listBackups(): BackupInfo[] {
  if (!fs.existsSync(BACKUP_DIR)) return [];
  return fs
    .readdirSync(BACKUP_DIR)
    .filter((f) => f.endsWith(".sqlite") || f.endsWith(".dump") || f.endsWith(".sql"))
    .map((f) => {
      const st = fs.statSync(path.join(BACKUP_DIR, f));
      const engine: BackupInfo["engine"] = f.endsWith(".sqlite") ? "sqlite" : f.endsWith(".dump") ? "postgres" : "unknown";
      return { name: f, size: st.size, at: st.mtime.toISOString(), engine };
    })
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}

function stamp(d = new Date()) {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/** Two backups inside the same second must not collide (VACUUM INTO refuses to overwrite). */
function freeName(prefix: string, ext: string) {
  const base = `${prefix}-${stamp()}`;
  let candidate = `${base}.${ext}`;
  for (let i = 2; i < 50 && fs.existsSync(path.join(BACKUP_DIR, candidate)); i++) candidate = `${base}-${i}.${ext}`;
  return candidate;
}

/** Take a snapshot. Returns the created file's info plus how old files were pruned. */
export async function createBackup(prefix = "backup"): Promise<{ ok: boolean; file?: BackupInfo; pruned?: number; error?: string }> {
  ensureDir();
  try {
    if (isPostgres()) {
      const { spawnSync } = await import("child_process");
      const name = freeName(prefix, "dump");
      const target = path.join(BACKUP_DIR, name);
      /* Connection goes through PG* env, not argv: a URL on the command line puts the
         production password in `ps` output for every local user for the life of the dump.
         pg_dump then needs a database name, which it takes from PGDATABASE. */
      const r = spawnSync("pg_dump", ["--format=custom", "--file", target], {
        encoding: "utf8",
        /* pgEnvFromUrl returns a plain record so it stays testable without @types/node;
           the value IS a copy of process.env plus the PG* connection settings, which is
           structurally what spawnSync wants. */
        env: pgEnvFromUrl(String(process.env.DATABASE_URL || "")) as NodeJS.ProcessEnv,
      });
      if (r.status !== 0) return { ok: false, error: r.error?.message || r.stderr || "pg_dump failed" };
      const st = fs.statSync(target);
      await logApp("INFO", "BACKUP", `backup created: ${name}`, { size: st.size, engine: "postgres" });
      return { ok: true, file: { name, size: st.size, at: st.mtime.toISOString(), engine: "postgres" } };
    }
    const live = sqlitePath();
    if (!live || !fs.existsSync(live)) return { ok: false, error: "SQLite file not found — DATABASE_URL: " + (process.env.DATABASE_URL || "(unset)") };
    const name = freeName(prefix, "sqlite");
    const target = path.join(BACKUP_DIR, name);
    // VACUUM INTO is the safe way to snapshot a live SQLite database
    await db.$executeRawUnsafe(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
    const st = fs.statSync(target);
    await logApp("INFO", "BACKUP", `backup created: ${name}`, { size: st.size, engine: "sqlite" });
    return { ok: true, file: { name, size: st.size, at: st.mtime.toISOString(), engine: "sqlite" } };
  } catch (e: any) {
    await logApp("ERROR", "BACKUP", "backup failed: " + (e?.message || e));
    return { ok: false, error: e?.message || String(e) };
  }
}

/** Keep the newest `keep` files, delete the rest. Never deletes a .pre-restore safety copy. */
export async function pruneBackups(keep = KEEP_DEFAULT): Promise<number> {
  const files = listBackups().filter((f) => !f.name.includes(".pre-restore"));
  let removed = 0;
  for (const f of files.slice(Math.max(0, keep))) {
    try {
      fs.unlinkSync(path.join(BACKUP_DIR, f.name));
      removed++;
    } catch {}
  }
  if (removed) await logApp("INFO", "BACKUP", `pruned ${removed} old backup(s), kept ${keep}`);
  return removed;
}

export function resolveBackup(name: string): string | null {
  const safe = path.basename(String(name || ""));
  if (!safe || safe.includes("..") || !/\.(sqlite|dump|sql)$/.test(safe)) return null;
  const full = path.join(BACKUP_DIR, safe);
  return fs.existsSync(full) ? full : null;
}

/** Restore a SQLite snapshot. The live database is parked first so this is reversible. */
export async function restoreBackup(name: string, confirm: string): Promise<{ ok: boolean; error?: string; movedTo?: string }> {
  if (String(confirm || "").trim().toUpperCase() !== "RESTORE") {
    return { ok: false, error: 'Type RESTORE (exactly) to confirm — this replaces the live database.' };
  }
  const file = resolveBackup(name);
  if (!file) return { ok: false, error: "Backup file not found" };
  if (file.endsWith(".dump")) {
    return { ok: false, error: "Postgres restore is done on the server: pg_restore --clean --dbname $DATABASE_URL " + path.basename(file) };
  }
  const live = sqlitePath();
  if (!live || !fs.existsSync(live)) return { ok: false, error: "Live SQLite file not found" };
  try {
    const safety = `${live}.pre-restore-${stamp()}`;
    fs.copyFileSync(live, safety);
    // copy the snapshot over the live file; SQLite picks it up on the next connection
    fs.copyFileSync(file, live);
    await logApp("WARN", "BACKUP", `database restored from ${path.basename(file)}`, { safetyCopy: path.basename(safety) });
    return { ok: true, movedTo: path.basename(safety) };
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  }
}

export function humanSize(bytes: number) {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}
