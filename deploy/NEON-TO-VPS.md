# Moving the database from Neon to the VPS

Short version: **dump Neon → restore into a *fresh empty database on the VPS Postgres* → verify → flip
`DATABASE_URL` → keep Neon paused as the rollback.**

Two tools, pick by one fact — the Postgres major of the Neon source:

| | use |
|---|---|
| [`vps-migrate.sh`](./vps-migrate.sh) | **use this one.** Runs on the VPS host with no repo checkout, finds Dokploy's compose project off the
  running container, and gets `pg_dump`/`psql` from a throwaway `postgres:18-alpine` container — required, because
  Neon is on **PG 18** (measured below) and `pg_dump` aborts when its client major is older than the source. |
| [`neon-to-vps.sh`](./neon-to-vps.sh) | the older runner, still fine if your source is ≤ the `db` image (PG 16); it takes `RUNNER=container`
  from `deploy/docker-compose.vps.yml`. Kept because `switch-db.sh` and the Vercel-era notes refer to it. |
| [`switch-db.sh`](./switch-db.sh) | cutover helper either way: backs up the env file, writes the new URL, restarts, health-gates, self-rolls-back. |

This file is the part no script can do for you (cloud consoles, DNS, webhooks) plus the traps.

## 0. Measured on 2026-09-17 against your actual project — read this before the run

| Fact | Value | What it means for the run |
|---|---|---|
| Neon project / region | `sinzo` = `dark-pond-52917738`, `aws-ap-southeast-1` | every query from the VPS pays a WAN round-trip today |
| Server version | **Postgres 18** | `postgres:16-alpine`'s `pg_dump` refuses it → `TOOL_IMAGE=postgres:18-alpine` (the default in `vps-migrate.sh`). The `db` service can stay on 16. |
| Branches | `production` (primary, endpoint `ep-gentle-boat-azlgwrh8`) **and** `new-store` (`ep-morning-mouse-azjvybnu`) | **check which endpoint host the app's `DATABASE_URL` actually names** (`vps-migrate.sh discover` prints it, masked). Migrating the other branch is silent data loss. |
| Data size | 101 MB on `production` | ~100 MB dump; 20 GB free on the box is ample |
| Transfer quota | **5.12 GB of 5 GB used** (period ends 2026-10-01) | connections can start failing any time; the dump costs one more ~101 MB |
| Why the quota ran out | images are stored as `Media.data bytea` and the app streams them, so every product picture is Neon egress | the day the DB is local this collapses to near zero — this migration *is* the fix, not a workaround |
| Who serves the shop today | the **VPS**: `sinzooffcial.com` → `162.4.112.68`, no `x-vercel-id`, and `server.sinzooffcial.com` answers identically | no DNS work and no Vercel teardown is needed for the DB move; only `DATABASE_URL` changes |
| VPS `db` service | `postgres:16-alpine`, `POSTGRES_DB=sinzo`, **no published port** (host `5432` answers RST) | nothing to firewall afterwards; but it also means the restore **must** run on the box, from a container joined to the compose network |
| Panel/API access | Neon **API key can read the project but cannot reveal the DB password**; SQL-over-HTTP needs a connection string too; Dokploy's tRPC paths differ in this build | the direct connection string has to come from you (Console → Connection Details, *Pooled* off) or from `/etc/dokploy/compose/*/.env`, which `vps-migrate.sh` greps for you as root |

---

## 0b. Before you start

| Need | Why |
|---|---|
| Neon **direct** (non-pooled) URL | `postgresql://USER:PASSWORD@DIRECT_NEON_HOST/DATABASE?sslmode=require`. The `-pooler` host works for queries but is hostile to `pg_dump`. The PostgREST URL from the audit **cannot** copy data — it needs a JWT and serves rows, not a dump. |
| VPS shell or Dokploy → app → Console | the restore runs on the box |
| ~2× DB size free disk | dump + restored copy coexist. `precheck` prints the size; check `df -h`. |
| 2–5 min window with the app stopped | only for the final `catchup`; everything else happens with the store live |
| A generated `POSTGRES_PASSWORD` (not a reused one) | the VPS `db` service auth |

Nothing in `neon-to-vps.sh` ever writes to `SRC_URL`. Neon stays exactly as it was — that *is* the rollback.

### "DB URL" means the connection string, not the API URL
This is **not** a connection string and cannot be used by `pg_dump`/Prisma:
```
https://ep-xxxx.apirest.<region>.aws.neon.tech/neondb/rest/v1     ← PostgREST: row API, needs a JWT
```
What you need is:
```
postgresql://<user>:<password>@ep-xxxx.<region>.aws.neon.tech/neondb?sslmode=require      ← direct
postgresql://<user>:<password>@ep-xxxx-pooler.<region>.aws.neon.tech/neondb?sslmode=require  ← pooled (works for the app, use direct for the dump)
```
Neon Console → your project → **Connection Details** → toggle *Pooled* **off** → copy. `switch-db.sh`
refuses anything that is not `postgresql://…` on purpose, so a paste of the `/rest/v1` URL fails loudly
instead of bricking the app at 3am.

**If you genuinely cannot get the connection string** (project deleted credentials, no console access):
the only other route is to copy rows over the REST API — `GET /rest/v1/<table>?select=*&order=id&offset=…&limit=1000`
with the `service_role` JWT, then `POST` them into the VPS table and run `sequences`. It works for this
schema (24 tables, all with an integer `id` except `Media`, which is cuid) but it is slower and it needs
the service key, which you should rotate anyway. Say the word and I will write it as
`deploy/rest-to-postgres.js`.

## 1. What is actually in there (read from this repo, not guessed)

- 24 base tables, 21 of them with sequences (`prisma/schema.prod.prisma`).
- **Uploaded images live in the database** — `Media.data bytea` (+ `variantsJson`, `blurData`), served by
  `app/api/media/[id]/route.ts`. So the dump carries your pictures; there is nothing to `rsync`.
  `/uploads/seed/*` (demo shots) is in git. This also means the dump is *bigger than the row counts
  suggest* — `precheck` shows the `Media` byte total separately.
- Money-critical: `Order`, `OrderItem`, `Product`, `ProductVariant` (stock), `Coupon`, `Customer`,
  `AbandonedCheckout`.
- Optional shrink: `SKIP_TABLES='TrackingEvent AuditLog'` keeps those tables' structure but not their rows.
- Login rate limiters are in-process memory (`lib/auth.ts`), so they reset on restart either way — no data to move.
- The prod datasource has **no `directUrl`**, which means `prisma migrate`/`db push` go through whatever
  `DATABASE_URL` is set to. Fine for a pooled app; on a self-hosted box you can point it straight at Postgres.

## 2. Two decisions you have to make first

**(a) What happens to the Vercel deployment?**
Your VPS Postgres is not reachable from Vercel unless you publish 5432 to the internet, which you should not do.

| Option | Notes |
|---|---|
| **Retire the Vercel app** (recommended) | DNS `sinzooffcial.com` → VPS. Kills the split-brain the `Order.channel` column exists to work around, and you stop paying for two runtimes. |
| Keep Vercel for static/marketing only | Remove `DATABASE_URL` there and make `/api/*` fail loudly, otherwise it silently half-works. |
| Keep both, both on the VPS DB | Needs `sslmode=require` + a real cert + IP allowlist, and every query pays a WAN round-trip. Not recommended. |

**(b) Is the VPS `db` service already holding real data?**
`deploy/docker-compose.vps.yml` defines its own `sinzo` database. If orders were placed through the VPS
deployment, those rows are real. `precheck` prints the target's `Order` count. The script **refuses** to
restore into a non-empty database — that refusal is the feature. Two honest paths:

1. restore into a **new** database (`sinzo_live`), verify, flip — then deal with the old one; or
2. if the VPS-side orders matter, keep them: `FORCE_RESTORE` is *not* the answer; merge is (re-insert with
   new ids, or archive the old DB and relabel `channel`). Ask and I'll write the merge.

## 3. The run

Get the one script onto the box (the repo is private, so pull it with a token that never reaches the command line):

```bash
read -rs -p 'GitHub token (paste, it is not echoed): ' GHT; echo
git clone --depth 1 "https://oauth2:${GHT}@github.com/mdmunna26260-hash/sinzo-commerce.git" /tmp/mig
unset GHT; cp /tmp/mig/deploy/vps-migrate.sh /usr/local/bin/; rm -rf /tmp/mig; chmod +x /usr/local/bin/vps-migrate.sh
```

Then, as root on the VPS host (Dokploy → your server → Terminal, or ssh) — the store stays live until step 6:

```bash
docker ps --format '{{.Names}} {{.Image}}' | grep -i postgres || true   # if no db: docker compose up -d db
vps-migrate.sh discover     # which DB the app really points at, disk, compose project — read it
vps-migrate.sh check        # version gate + both sides reachable + emptiness (asks for the Neon URL once)
vps-migrate.sh plan         # prints the whole run, executes nothing
vps-migrate.sh prep         # CREATE DATABASE sinzo_live
vps-migrate.sh dump         # ~101 MB, store live
vps-migrate.sh restore
vps-migrate.sh verify       # must end: "verify clean"
```

`SRC_URL` resolution order is: your env → `/dev/shm/sinzo-src-url` (0600, tmpfs, removed by `forget`) → a
`neon.tech` URL grepped out of `/etc/dokploy/compose` (de-pooled automatically: `-pooler` removed) → a
hidden prompt. It is never written to the data disk and never echoed unmasked.

Cutover — only this part wants the app stopped, and it is the 2–5 minute window:

```bash
vps-migrate.sh catchup      # stop the app in Dokploy first: TRUNCATE + data-only reload + setval
vps-migrate.sh verify       # clean again
vps-migrate.sh url          # prints the DATABASE_URL to paste into Dokploy (env, then redeploy)
```

If you use `neon-to-vps.sh` instead: `RUNNER=container` reaches the DB through `127.0.0.1` **inside** the
`db` container, because the service publishes no port (verified 2026-09-17: host `5432` answers RST, so
nothing is exposed — and also nothing is reachable from the host). To use the host path, add a temporary
`ports: ["127.0.0.1:5432:5432"]` and `RUNNER=host`.

**Version floor (this is the one that bit):** `pg_dump` aborts when the source server is a newer major than the
client, and your Neon is **PG 18** while `deploy/docker-compose.vps.yml` is `postgres:16-alpine`.
`vps-migrate.sh` therefore runs client tools in its own `TOOL_IMAGE=postgres:18-alpine` container joined to the
`db` service's network (and rewrites a `127.0.0.1` target URL to `@db:` for you). `neon-to-vps.sh` cannot dump
this source — its `precheck` only warns. Do **not** "fix" it by bumping the `db` service to 18 before the
restore: a PG 18 data directory cannot be read by a PG 16 server, and `pgdata` is a named volume that survives.

## 3b. No-root route — copy from INSIDE the app container (use this if you have no host shell)

`prisma/migrate-from-neon.js` needs no SSH, no `docker` CLI, no `pg_dump` and no typed credential: the app
container already holds the Neon URL in its own `DATABASE_URL`, and it sits on the same compose network as the
`db` service. It is in `prisma/` **on purpose** — the runner image copies `prisma/` but not `scripts/` (see
Dockerfile), so a helper in `scripts/` would not exist inside the container.

Dokploy → your Compose deployment → **app service → Console** (the terminal with the `>` prompt; `ls /app`
must show `.next  node_modules  prisma  public`). Step 0 — find out what you actually have:

```sh
getent hosts db >/dev/null && echo "db service present" || echo "NO db service — you must create one first"
printenv DATABASE_URL | sed -E 's#:[^@]*@#:•••@#'         # which Neon endpoint the live app really uses
```

If the deployed image predates this commit and you would rather not rebuild, install the helper from inside
the container — `node:24` has a global `fetch` and nothing else useful is in there:

```sh
cd /app
export GHT='<your github token>'        # read from the environment, so it is not in the node argv
node -e 'fetch("https://raw.githubusercontent.com/mdmunna26260-hash/sinzo-commerce/main/prisma/migrate-from-neon.js",{headers:{authorization:"Bearer "+process.env.GHT}}).then(r=>{if(r.status!==200)throw new Error("HTTP "+r.status);return r.text()}).then(t=>{require("fs").writeFileSync("prisma/migrate-from-neon.js",t);console.log("installed",t.length,"bytes")}).catch(e=>{console.error(e.message);process.exit(1)})'
unset GHT
```

(Verified 2026-09-17: that URL returns the byte-identical file — sha256 starts `678844005b3f2191`, matching the
copy tested below. Prefer the rebuild if you were going to redeploy anyway; the file lives in `prisma/` in the image.)

If `db` is absent, create one in Dokploy (Compose → add the `db` service from
`deploy/docker-compose.vps.yml`, or Dokploy's own Postgres database service) and use the host/port it hands you.
Then, from `/app`:

```sh
DST_URL='postgresql://sinzo:<PW>@db:5432/sinzo' node prisma/migrate-from-neon.js --dry   # counts only
DST_URL='postgresql://sinzo:<PW>@db:5432/sinzo' node prisma/migrate-from-neon.js         # full copy, app live
```

`<PW>` is `POSTGRES_PASSWORD` of the db service — read it from the **db** service's Console
(`printenv POSTGRES_PASSWORD`); the app container does not necessarily have it.

Then, with the app **stopped** (Dokploy → Stop), the delta pass — you only have to name the parents, child
tables are dragged along automatically because `TRUNCATE … CASCADE` would empty them:

```sh
DST_URL='…' node prisma/migrate-from-neon.js --only=Order,Product,ProductVariant,Customer,Coupon,Review
DST_URL='…' node prisma/migrate-from-neon.js --verify-only      # source=DATABASE_URL_OLD, target=DATABASE_URL
```

How it differs from `vps-migrate.sh`, and when it is the wrong tool:

| | |
|---|---|
| Schema | if the target has no tables it runs `prisma db push` itself (an empty target loses nothing), so there is no separate "restore the schema" step |
| Order | tables are copied parents-first, computed from `pg_constraint` on the source — never hand-maintained |
| Paging | keyset on the **whole** primary key, so `CollectionProduct`'s composite PK cannot skip rows; `bytea` tables copy 12 rows per round-trip because the app container is capped at 768 MB (`NODE_OPTIONS`) |
| Guards | refuses a non-empty target unless you pass a `--only`/`--truncate` set; any table that ends up with fewer rows than the source had is a hard failure, not a note |
| Sequences | `setval(next = max+1, is_called=false)` for every integer PK, then proved by reading the sequence (not `pg_sequences`, whose `last_value` is NULL in exactly that state) |
| **Slow on big data** | it is row-by-row SQL over Prisma, not `pg_dump`. ~100 MB of `Media` took a few minutes on the test fixture; for a multi-GB database use `vps-migrate.sh` on the host instead |

## 3c. Panel-only route — ONE environment line (start here if you have no shell on the box)

The image runs `docker-entrypoint.sh` before Next.js binds the port, and that hook runs
`prisma/migrate-from-neon.js` **only while `MIGRATE_ON_BOOT` is set**. Everything else is Dokploy's own UI.

In Dokploy → your compose service → **Environment**, add one line, then **Deploy**:

```
MIGRATE_ON_BOOT = cutover
```

That single deploy does, in order: derive the VPS database URL from the container's own `POSTGRES_PASSWORD`
(host `db`, user/db `sinzo`, all overridable with `MIGRATE_DB_HOST` / `MIGRATE_DB_USER` / `MIGRATE_DB_NAME` /
`MIGRATE_DST_URL`) → full copy, `Media` image bytes included → sequences → `verify`. **Only if verify is clean**
it writes `/tmp/sinzo-cutover.url`, and the entrypoint exports `DATABASE_URL` from it for the app process — so
the shop comes up on the VPS database in that same deploy, without you editing `DATABASE_URL` at all. Any
failure leaves it on Neon, and the log says exactly which line to add. Extra downtime is the copy itself, which
hides inside the restart the deploy was already doing.

Open the deploy's **Logs**, and read for `[migrate] DONE` or `[migrate] refusing to continue`.

Then finish the job at your convenience, before the next deploy: set `DATABASE_URL` in the panel to the VPS
value (or delete the override so the compose file's own `DATABASE_URL: postgresql://sinzo:${POSTGRES_PASSWORD}@db:5432/sinzo`
line applies) and remove `MIGRATE_ON_BOOT`. Until you do, two protections cover you:

| Situation | What happens |
|---|---|
| container restarted, marker still in `/tmp` | the copy is skipped entirely — re-running a Neon copy after the cutover would truncate the VPS tables and overwrite newer sales |
| new container (marker gone) and the target already has newer orders | it does NOT copy, writes the marker, and starts on the VPS database anyway: "the cutover has already happened" |
| new container, target empty, verify fails | app starts on Neon, nothing written to the target — full rollback by doing nothing |

Other `MIGRATE_ON_BOOT` values, if you want the steps separated: `full` (copy only, refuses a non-empty target,
app stays on Neon) and `final` (the busy-tables delta for a deploy that already points `DATABASE_URL` at the VPS
database). `DEPLOY_CHANNEL=vps` is worth setting in the same edit so orders keep being labelled by origin.

Caveat: this needs Dokploy to build the image from the repo (`build: .`) and not to override the entrypoint — if
the service has a custom Command/Entrypoint in the panel, clear it or use §3b (Console) instead.

Tested as the real thing: an empty target + `cutover` → `verify clean` on 24/24 tables, the app process printed
`APP sees: /sinzo_dst`; a second boot with the marker → `skipping the copy`; marker deleted after the VPS side
took a newer order → `the target already holds newer orders (5 vs 4) … NOTHING is copied`, app on the VPS
database, orders intact (`count 5, sum 3650`). Bugs found while building it: a space-separated `--only` default
that the comma-only splitter turned into one bogus table name; a same-host guard that refused two databases on
one host; `cutover` initially reusing `final`'s busy-tables set, which on an empty target would have booted the
app on a database with no `Media`/`Setting`.

### Cutover (the only window that needs the app down)

```bash
docker compose -p <project> stop app            # or Dokploy → app → Stop   (<project> = from `discover`)
vps-migrate.sh catchup      # orders that arrived while the restore ran; TRUNCATE+COPY, then setval
vps-migrate.sh verify       # must be clean again
```
Then flip the connection string — `vps-migrate.sh url` prints it. Either in Dokploy → app service → Environment:
```
DATABASE_URL = postgresql://sinzo:THE_POSTGRES_PASSWORD@db:5432/sinzo_live
DEPLOY_CHANNEL = vps
```
or, if the env lives in a `.env` next to the compose file, with the helper that backs the file up, restarts,
health-gates and **rolls itself back** if `/api/health` never answers 200:
```bash
./switch-db.sh --env-file /etc/dokploy/compose/<dir>/.env \
  --url 'postgresql://sinzo:THE_POSTGRES_PASSWORD@db:5432/sinzo_live'
./switch-db.sh --env-file /etc/dokploy/compose/<dir>/.env --rollback      # undo, any time
```
`switch-db.sh` is a repo file; if you did not keep the checkout, edit the env in the panel instead — it is the
same two lines. `DATABASE_URL` is server-side, so a **restart** is enough, no rebuild. Then start the app and
re-run `vps-migrate.sh verify` (Neon has stopped moving, so the two sides should now be permanently equal
until the first new order lands on the VPS).

### Proof it actually works — do these three, in order

```bash
curl -s https://sinzooffcial.com/api/health
vps-migrate.sh verify
```
and then **place a real ৳1 test order and cancel it**, because an out-of-sync sequence does not show up in any
count — it shows up as a 500 at checkout:
```bash
docker compose -p <project> exec -T db \
  psql -U sinzo -d sinzo_live -c 'select id,code,"createdAt" from "Order" order by id desc limit 3;'
```
`id` must be the old max **+1**, not a number that already existed.

`scripts/verify-db-migration.js` (the Prisma-side twin of `verify`) **cannot be run inside the VPS app
container**: `Dockerfile` copies only `.next`, `node_modules`, `public`, `package.json`, `prisma` and
`next.config.mjs` into the runner image — `scripts/` is not in it. Same reason `scripts/ensure-db.js` in the
image `CMD` always prints "skipped". If you want the Prisma-level check, copy it in first:
```bash
APPC=$(docker ps -q --filter label=com.docker.compose.service=app | head -1)
docker cp /var/backups/sinzo-migration/verify-db-migration.js "$APPC":/tmp/v.js   # or from the clone
docker compose -p <project> exec -T -e SRC_URL="$SRC_URL" app node /tmp/v.js
```

## 4. Things that bite afterwards

- **The app image has no `scripts/`** (verified in `Dockerfile`: only `.next`, `node_modules`, `public`,
  `package.json`, `prisma`, `next.config.mjs` are copied). So the boot-time `node scripts/ensure-db.js`
  never runs on the VPS — it prints "skipped" and carries on. Harmless today (the schema is already
  migrated on the source), but it means "the container fixes the column itself" is not true on this box.
  Decide separately whether to add `COPY --from=builder /app/scripts ./scripts` (it also switches on the
  boot-time schema writes, so do not bundle it with a migration).
- **Sequences.** A full `pg_dump -Fc` restore embeds `setval`, so it is already right after `restore`
  (measured: `last_value = max(id) = 41`). A `--data-only` reload — i.e. `catchup` — does **not**, which is
  why `catchup` runs the `sequences` pass automatically. Skip it and the first customer order fails with
  Prisma `P2002`.
- **Steadfast callbacks** (courier status webhooks) and any integration pointed at the old host — update in
  the courier dashboard, or tracking stops updating while the store seems fine.
- **Meta CAPI**: server-side events fire from whichever instance handles checkout. If you retire Vercel, the
  events it was sending stop; confirm Events Manager still shows test events 5–10 min after cutover.
- **`NEXT_PUBLIC_SITE_URL`** must be the final public URL in the surviving deployment, or canonical/OG/social
  previews keep naming the retired host. (It is a build-time var on Vercel → rebuild there if you keep it.)
- **`Order.channel`** (`lib/deploy-channel.ts`): with one deployment the admin "own channel" filter
  (`app/api/admin/orders/route.ts`) only shows that channel's history. To unify past orders:
  `UPDATE "Order" SET channel='vps' WHERE channel='vercel';` — count first, then update in the same session.
- **Backups are now your job.** Neon's snapshots/pit branched stop protecting you. Put the cron in the day you
  cut over, not "later":
  ```
  15 3 * * * cd /path/to/sinzo-commerce && docker compose -f deploy/docker-compose.vps.yml exec -T db \
    pg_dump -U sinzo -Fc sinzo_live | gzip > /var/backups/sinzo/sinzo-$(date +\%F).dump \
    && find /var/backups/sinzo -mtime +14 -delete
  ```
  and copy at least one dump per week **off the box** — a VPS provider's snapshot is not a backup.
- **`uploads` volume**: seed images are in git, DB media moves with the dump — but if anything ever wrote
  files under `public/uploads` outside `/seed`, copy the volume before you destroy the old container:
  `docker run --rm -v <project>_uploads:/from alpine cp -a /from /to` style, or `docker cp`.
- **Rotation still owed from the audit**: the Neon `service_role` JWT, the GitHub PAT and the admin/VPS
  passwords that were pasted into a chat. The admin password itself travels *with* the database, so no reset
  is needed to log in after the move — rotate it because it leaked, using
  `docker compose exec app node scripts/set-admin-password.js '<new>'`.
- **Pause, don't delete, Neon** for 7–14 days. `pg_dump` of the source again costs nothing while it exists;
  an unrecoverable mistake costs the store.

## 5. Rollback

1. Dokploy: set `DATABASE_URL` back to the Neon string, restart. Done — Neon was never written to.
2. If the app already wrote orders to the VPS database during the trial, move them back **before** flipping:
   run the same `catchup` with `SRC_URL`/`DST_URL` swapped (the script only reads `SRC_URL`), then flip.

## 6. Where these numbers came from

Everything above was exercised in a sandbox: Postgres 17, your real `prisma/schema.prod.prisma`, seed data
plus 41 orders and 3 `Media` rows holding 469 kB of image bytes.

- `precheck → dump → restore → verify`: 24/24 tables equal, `sum(total)=51570` equal, sequences already
  correct after the full restore.
- Deleted one `OrderItem` on the target → `verify` flagged `42 vs 41` and exited 1.
- `catchup` data-only reload with 5 new source orders → money/id/freshness all flagged before the fix, and the
  app's own `order.create` failed with `P2002`; after the `sequences` pass the same insert returned `id=47`.
- `scripts/verify-db-migration.js` — exit 0 when aligned, exit 1 on drift, `--json` emits pure JSON for CI.
`prisma/migrate-from-neon.js` was then exercised against a **real** Postgres 17 pair (`sinzo_src` → `sinzo_dst`,
no stubs): the seeded prod schema plus 40 synthetic `Media` rows of 600 kB (so the bytea paging path ran),
18 composite-PK `CollectionProduct` rows, 60 variants. `--dry` wrote nothing; a full copy ended `verify clean`
with all 24 tables equal and `Order.sum(total)`/`max(id)`/`max(createdAt)` matching; a `--only=Order` run printed
`auto-added to the copy because CASCADE would empty them: OrderItem` and left both tables consistent; re-running
without `--truncate` on a 171-row target refused and touched nothing; and the decisive test — `order.create()`
on the target **without** an id — returned `id = 3`, old max + 1, so the first real order cannot collide.
Bugs the fixture caught before shipping: `::regclass::text` renders `"Category"` with quotes, so the PK/FK maps
matched nothing and the copy silently delivered 3 of 7 categories while reporting `ok`; `MAX(id)` on a cuid PK
typed as text; `COALESCE(sum(total),'-')` mixing double precision with text; a `AS m` alias read through a
helper expecting `.n`, which made the sequence pass advance 0 sequences on a green run; `pg_sequences.last_value`
being NULL for the state this script creates; the target's table list being read before the schema push; and a
keyset cursor that was computed but never passed to the next query.

On 2026-09-17 the project itself was measured through the Neon API (`GET /projects`, `/endpoints`,
`/branches`, `/roles`): PG 18, region `aws-ap-southeast-1`, `production` branch `br-empty-fire-azq55s4e` at
105 848 832 bytes (101 MB), a second branch `new-store` also with a read_write endpoint, roles
`neondb_owner` + `authenticated`/`anonymous`/`authenticator` (left over from the PostgREST experiment),
`data_transfer_bytes` 5 122 544 195 against a 5 GB allowance, period 2026-09-01 → 2026-10-01. The API key
cannot return a password (`store_passwords: true` only means Neon stores them for the console).

`vps-migrate.sh` was exercised against a stubbed `docker` + `psql`/`pg_dump`/`pg_restore` (24 real tables from
`schema.prod.prisma`, 8 orders, 212 Media rows, 101 MB of image bytes): `check` passed, `plan` printed the run
and executed nothing, `dump` → `restore` → `verify` ended "verify clean", and each guard fired —
`TOOL_IMAGE=postgres:16-alpine` → dies with the exact override to use; `restore` into a target holding 24
tables → refuses; `prep` onto a non-empty `sinzo_live` → refuses and prints the deliberate drop command;
one extra order on the source → `verify` flags the row and exits 1. `catchup` resolved the FK closure to the
10 requested tables and ran the `setval` pass. Also fixed while testing: the last entry of `CATCHUP_TABLES`
was always reported as "auto-included" (a membership test that never matched the final item) in **both**
scripts, and `plan` died on the missing dump instead of printing the restore step.

- Bugs found and fixed while testing it: `pg_dump --truncate` does not exist in PG ≤ 17 (so truncate is
  explicit + an FK-closure expansion), a single-quoted SQL template that swallowed its own quotes, `sql()`
  leaking its banner into captured values, `nextval()` in the verify step burning an id per run,
  `sequences` demanding `SRC_URL` it does not need, and `--json` skipping the exit code.
