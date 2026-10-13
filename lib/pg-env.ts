/* pg_dump / libpq connection environment.

   Both backup paths used to hand pg_dump the whole DATABASE_URL as a command-line
   argument:

       spawnSync("pg_dump", ["--format=custom", "--file", target, DATABASE_URL])

   argv is world-readable on the host. `ps aux`, or /proc/<pid>/cmdline for any local
   user, showed the production Postgres password for as long as the dump ran — minutes
   on a database of any size, and this is exactly the window a shared VPS or a
   compromised low-privilege account is looking for. The password also lands in shell
   history and in any process-accounting log.

   libpq reads the connection from PG* environment variables, which are visible only to
   the same uid. Parse the URL and hand the parts over that way.

   Zero dependencies and no side effects on purpose: it is security-relevant, it must be
   testable without a database, and scripts/backup.js (plain CommonJS, run standalone
   from cron) keeps a mirror of it. tests/pg-env.test.cjs asserts the two copies agree,
   so the mirror cannot drift. */

export type PgEnv = Record<string, string | undefined>;

export function pgEnvFromUrl(url: string, base: PgEnv = process.env): PgEnv {
  const env: PgEnv = { ...base };
  /* Never inherit an ambient PGPASSWORD. libpq would otherwise prefer a stale value
     from the parent shell over an absent one and dump the wrong database — or quietly
     carry a credential this process was not given. */
  delete env.PGPASSWORD;
  try {
    const u = new URL(url);
    if (u.protocol !== "postgres:" && u.protocol !== "postgresql:") return env;
    if (u.hostname) env.PGHOST = u.hostname;
    if (u.port) env.PGPORT = u.port;
    // Credentials are percent-encoded in a URL; libpq wants them decoded.
    if (u.username) env.PGUSER = decodeURIComponent(u.username);
    if (u.password) env.PGPASSWORD = decodeURIComponent(u.password);
    const dbName = decodeURIComponent(u.pathname.replace(/^\//, ""));
    if (dbName) env.PGDATABASE = dbName;
    // sslmode is the one query parameter that changes whether the dump can connect at
    // all (Neon and most managed Postgres require it), so it is carried across.
    const sslmode = u.searchParams.get("sslmode");
    if (sslmode) env.PGSSLMODE = sslmode;
  } catch {
    /* Not a parseable URL. Return the base env with no PG* connection settings so
       pg_dump fails loudly ("no database name specified") instead of connecting to
       whatever an inherited environment happened to point at. */
  }
  return env;
}

/* True when a DATABASE_URL is a Postgres connection string rather than `file:./dev.db`. */
export function isPostgresUrl(url: string | undefined): boolean {
  return /^postgres(ql)?:\/\//i.test(String(url || ""));
}
