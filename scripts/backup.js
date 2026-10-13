/* Database backup from the command line / cron (admin menu item 11 also does this in the panel).

   Daily on a VPS, e.g.:
     0 3 * * *  cd /var/www/sinzo && /usr/bin/npm run backup >> /var/log/sinzo-backup.log 2>&1

   SQLite → VACUUM INTO (a consistent snapshot even while the shop is live)
   Postgres → pg_dump --format=custom
   Keeps the newest 14 snapshots unless --keep N says otherwise. */
const fs = require("fs");
const path = require("path");

/* Load .env ourselves: cron and `node scripts/backup.js` do not run through Next.js, so without
   this DATABASE_URL would be undefined and the backup would refuse to run. */
try {
  for (const line of fs.readFileSync(path.join(process.cwd(), ".env"), "utf8").split("\n")) {
    const m = line.match(/^\s*([\w.]+)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch {}

const DIR = process.env.BACKUP_DIR || path.join(process.cwd(), "backups");
const KEEP = (() => {
  const i = process.argv.indexOf("--keep");
  const n = i > -1 ? Number(process.argv[i + 1]) : 14;
  return Number.isFinite(n) && n > 0 ? n : 14;
})();

function stamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

(async () => {
  fs.mkdirSync(DIR, { recursive: true });
  const url = process.env.DATABASE_URL || "";
  const isPg = /^postgres(ql)?:/.test(url);
  const ext = isPg ? "dump" : "sqlite";
  const base = `backup-${stamp()}`;
  let name = `${base}.${ext}`;
  for (let i = 2; i < 50 && fs.existsSync(path.join(DIR, name)); i++) name = `${base}-${i}.${ext}`; // same-second guard
  const target = path.join(DIR, name);

  if (isPg) {
    const { spawnSync } = require("child_process");
    /* Connection through PG* env, not argv — a URL on the command line exposes the
       production password in `ps` output to every local user for the life of the dump. */
    const r = spawnSync("pg_dump", ["--format=custom", "--file", target], { stdio: "inherit", env: pgEnvFromUrl(url) });
    if (r.status !== 0) {
      console.error("backup: pg_dump failed —", r.error ? r.error.message : "exit " + r.status);
      process.exit(1);
    }
  } else {
    if (!/^file:/.test(url)) {
      console.error("backup: DATABASE_URL is not set to a file: or postgresql: url");
      process.exit(1);
    }
    const { PrismaClient } = require("@prisma/client");
    const db = new PrismaClient();
    try {
      await db.$executeRawUnsafe(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
    } catch (e) {
      console.error("backup: VACUUM INTO failed —", e.message);
      await db.$disconnect();
      process.exit(1);
    }
    await db.$disconnect();
  }

  const size = fs.statSync(target).size;
  console.log(`backup: wrote ${name} (${(size / 1024).toFixed(1)} KB)`);

  // retention — the safety copies made by a restore are never touched
  const files = fs
    .readdirSync(DIR)
    .filter((f) => /\.(sqlite|dump|sql)$/.test(f) && !f.includes(".pre-restore"))
    .map((f) => ({ f, t: fs.statSync(path.join(DIR, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  let removed = 0;
  for (const x of files.slice(KEEP)) {
    fs.unlinkSync(path.join(DIR, x.f));
    removed++;
  }
  console.log(`backup: ${files.length - removed} snapshot(s) kept${removed ? `, ${removed} pruned` : ""}`);
})();

/* libpq connection env parsed out of a postgres URL.

   MIRROR of lib/pg-env.ts — this script runs standalone from cron as plain CommonJS and
   cannot import the TypeScript module. tests/pg-env.test.cjs feeds both copies the same
   URLs and asserts identical output, so the mirror cannot drift silently. If you change
   one, change the other. */
function pgEnvFromUrl(rawUrl, base = process.env) {
  const env = { ...base };
  delete env.PGPASSWORD;
  try {
    const u = new URL(rawUrl);
    if (u.protocol !== "postgres:" && u.protocol !== "postgresql:") return env;
    if (u.hostname) env.PGHOST = u.hostname;
    if (u.port) env.PGPORT = u.port;
    if (u.username) env.PGUSER = decodeURIComponent(u.username);
    if (u.password) env.PGPASSWORD = decodeURIComponent(u.password);
    const dbName = decodeURIComponent(u.pathname.replace(/^\//, ""));
    if (dbName) env.PGDATABASE = dbName;
    const sslmode = u.searchParams.get("sslmode");
    if (sslmode) env.PGSSLMODE = sslmode;
  } catch { /* let pg_dump fail loudly rather than connect somewhere unexpected */ }
  return env;
}
