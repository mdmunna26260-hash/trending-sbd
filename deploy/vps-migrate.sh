#!/usr/bin/env bash
# SINZO — run THIS on the VPS host (Dokploy → your server → Terminal, or ssh). It moves the database
# from Neon into the VPS Postgres. No repo checkout needed, and no secret ever goes on a command line.
#
#   ./vps-migrate.sh discover   what is running, which DB the app points at, disk.   (read-only)
#   ./vps-migrate.sh check      version gate + reachability + emptiness of both sides (read-only)
#   ./vps-migrate.sh plan       print the whole run, execute nothing
#   ./vps-migrate.sh prep       CREATE DATABASE sinzo_live (refuses if it is not empty)
#   ./vps-migrate.sh dump       pg_dump -Fc → $WORKDIR/neon-<ts>.dump                 (Neon: READ only)
#   ./vps-migrate.sh restore    pg_restore into the fresh DB (refuses a non-empty one)
#   ./vps-migrate.sh verify     per-table counts + money + sequences → must print "verify clean"
#   ./vps-migrate.sh catchup    after stopping the app: re-copy the busy tables, then fix sequences
#   ./vps-migrate.sh sequences  setval() every sequence to max(id) (needed after any data-only reload)
#   ./vps-migrate.sh url        print the DATABASE_URL to put into Dokploy
#   ./vps-migrate.sh forget     drop the cached Neon URL (and optionally the dumps)
#
# Why it is written this way (all measured 2026-09-17; see deploy/NEON-TO-VPS.md §6):
#   * Neon runs Postgres 18. Our compose db image is postgres:16-alpine, and pg_dump aborts when the
#     client major is older than the server's — so client tools come from TOOL_IMAGE (default
#     postgres:18-alpine) in a throwaway container, joined to the db service's own compose network.
#   * The `db` service publishes no port (measured: host 5432 answers RST), so 127.0.0.1 means
#     nothing to a sibling container; inside that network the alias `db` does. A localhost DST_URL
#     is rewritten for you.
#   * Dokploy's compose project name is not the directory name, so a bare `docker compose exec`
#     finds nothing. We read com.docker.compose.project off the running container.
#
# Neon is only ever READ from here — that untouched copy is the rollback.
set -uo pipefail

# ------------------------------------------------------------- config (env overrides defaults)
DB_SERVICE="${DB_SERVICE:-db}"                  # compose service running Postgres
APP_SERVICE="${APP_SERVICE:-app}"                # compose service running Next.js (read for env only)
TOOL_IMAGE="${TOOL_IMAGE:-postgres:18-alpine}"  # client tools; major must be >= the Neon server's
DST_DB="${DST_DB:-sinzo_live}"                   # fresh target database this script creates
DST_OWNER="${DST_OWNER:-sinzo}"                  # role that owns it (= the app's role)
SRC_DB="${SRC_DB:-neondb}"                         # database name inside the Neon URL
OLD_DB="${OLD_DB:-sinzo}"                          # the db service's own POSTGRES_DB (pre-existing)
WORKDIR="${WORKDIR:-/var/backups/sinzo-migration}"
SRC_CACHE="${SRC_CACHE:-/dev/shm/sinzo-src-url}"   # tmpfs: gone on reboot, never on the data disk
CATCHUP_TABLES="${CATCHUP_TABLES:-Order OrderItem Product ProductVariant Customer Coupon Review InventoryMovement AbandonedCheckout PushSubscription}"
SKIP_TABLES="${SKIP_TABLES:-}"                     # e.g. "TrackingEvent AuditLog": schema kept, rows not copied
DOCKER_RUN_ARGS="${DOCKER_RUN_ARGS:-}"             # e.g. "--dns 1.1.1.1" if outbound DNS misbehaves
SRC_URL="${SRC_URL:-}"; DST_URL="${DST_URL:-}"
DRY=0; PROJECT=""; DB_CID=""; APP_CID=""; NET=""

say()  { printf '\033[1;36m▸ %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m! %s\033[0m\n' "$*" >&2; }
die()  { printf '\033[1;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }
mask() { sed -E 's#(//[^:/@]+:)[^@]+@#\1•••@#g'; }              # never let a password reach the screen
run()  { if [ "$DRY" = 1 ]; then echo "  + $*"; return 0; else eval "$*"; fi; }

# --------------------------------------------------- find Dokploy's project from the running db
find_db_container() {
  [ -n "$DB_CID" ] && return 0
  DB_CID="$(docker ps -q --filter "label=com.docker.compose.service=$DB_SERVICE" | head -1)"
  if [ -z "$DB_CID" ]; then
    DB_CID="$(docker ps --format '{{.ID}} {{.Names}}' | awk -v s="$DB_SERVICE" '$2 ~ ("(^|[-_])"s"(-|$)") {print $1; exit}')"
  fi
  [ -n "$DB_CID" ] || return 1
  PROJECT="$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project"}}' "$DB_CID")"
  NET="$(docker inspect -f '{{range $k, $v := .NetworkSettings.Networks}}{{$k}}
{{end}}' "$DB_CID" | awk 'NF{print; exit}')"
  APP_CID="$(docker ps -q --filter "label=com.docker.compose.project=$PROJECT" --filter "label=com.docker.compose.service=$APP_SERVICE" | head -1)"
  [ -n "$NET" ] || return 1
}
dc() { if [ -n "$PROJECT" ]; then docker compose -p "$PROJECT" "$@"; else docker compose "$@"; fi; }
db_pw() { [ -n "$DB_CID" ] || return 1
  docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$DB_CID" | sed -n 's/^POSTGRES_PASSWORD=//p' | head -1; }
url() { printf 'postgresql://%s:%s@%s:5432/%s' "$DST_OWNER" "$(db_pw)" "$DB_SERVICE" "$1"; }   # inside $NET

# ------------------------------------------------------------------ tool + sql wrappers (image mode)
tool() {  # run a Postgres client tool with a client new enough for the source; stdin/stdout pass through
  if [ "$DRY" = 1 ]; then echo "  + $TOOL_IMAGE $*"; return 0; fi
  # shellcheck disable=SC2086
  docker run --rm -i --network "$NET" $DOCKER_RUN_ARGS \
    -e SRC_URL="${SRC_URL:-}" -e DST_URL="${DST_URL:-}" "$TOOL_IMAGE" "$@"
}
sql() {   # sql <url> <statement> → rows on stdout; returns non-zero if psql errored
  local u="$1" q="$2"
  if [ "$DRY" = 1 ]; then echo "(sql suppressed in plan mode)"; return 0; fi
  printf '%s' "$q" | docker run --rm -i --network "$NET" $DOCKER_RUN_ARGS -e U="$u" "$TOOL_IMAGE" \
    sh -c 'exec psql "$U" -v ON_ERROR_STOP=1 -Atq'
}

# ------------------------------------------------------------- secrets: env → tmpfs cache → ask
load_src() {
  [ -n "$SRC_URL" ] && return 0
  [ -s "$SRC_CACHE" ] && { SRC_URL="$(cat "$SRC_CACHE")"; return 0; }
  local hit
  hit="$(grep -rohE 'postgre[sq][l]*://[^"'"'"' ]*neon\.tech[^"'"'"' )]*' /etc/dokploy/compose 2>/dev/null | head -1 || true)"
  if [ -n "$hit" ]; then
    SRC_URL="${hit//-pooler}"        # a pooled URL is hostile to pg_dump; direct = same host minus -pooler
    say "found a Neon URL in Dokploy's env — using the direct endpoint"
  else
    printf '\nPaste the Neon DIRECT connection string (Neon console → Connection details → Pooled = OFF),\nthen Enter. It stays in this shell + /dev/shm only, and ./vps-migrate.sh forget deletes it.\n  '
    IFS= read -r -s SRC_URL; echo
    case "$SRC_URL" in postgre*) ;; *) die "that does not look like a postgres URL";; esac
  fi
  case "$SRC_URL" in *neon.tech*) ;; *) warn "no neon.tech host in SRC_URL — is this really the source?";; esac
  case "$SRC_URL" in *-pooler*) warn "still looks pooled; pg_dump prefers the direct endpoint.";; esac
  case "$SRC_URL" in *\?*) ;; *) SRC_URL="$SRC_URL?sslmode=require"; warn "added ?sslmode=require";; esac
  mkdir -p "$(dirname "$SRC_CACHE")" && umask 077 && printf '%s' "$SRC_URL" > "$SRC_CACHE"
  say "source: $(printf '%s' "$SRC_URL" | mask)"
}
need_dst() {
  find_db_container || die "no running '$DB_SERVICE' container — start it:  docker compose up -d $DB_SERVICE
   (if Dokploy names services differently: DB_SERVICE=<name> ./vps-migrate.sh ...)"
  [ -n "$DST_URL" ] || DST_URL="$(url "$DST_DB")"
  say "target: $(printf '%s' "$DST_URL" | mask)"
}

# ---------------------------------------------------------------------- the version gate (the trap)
gate_versions() {
  say "client vs server (pg_dump needs client major >= source server major)"
  local sv cv
  if [ "$DRY" = 1 ]; then say "plan mode: both versions would be read here (source must be <= $TOOL_IMAGE)"; return 0; fi
  sv="$(sql "$SRC_URL" "SELECT current_setting('server_version');" | tail -1)"
  cv="$(docker run --rm "$TOOL_IMAGE" pg_dump --version | awk '{print $NF}')"
  echo "  source (Neon) server: ${sv:-?}    client from $TOOL_IMAGE: ${cv:-?}"
  { [ -n "$sv" ] && [ -n "$cv" ]; } || die "could not read both versions. Is SRC_URL the direct endpoint, and can this box reach Neon on 5432? (Neon → Settings → Network: no IP allowlist, or add this VPS)"
  local s c; s="${sv%%.*}"; c="${cv%%.*}"
  case "$s$c" in *[!0-9]*) return 0;; esac
  if [ "$c" -lt "$s" ]; then
    die "TOOL_IMAGE=$TOOL_IMAGE ships pg_dump $c but the source is PG $s — pg_dump would abort.
   Run it as:  TOOL_IMAGE=postgres:${s}-alpine ./vps-migrate.sh $1
   (the db service itself can stay postgres:16-alpine — only the tool container needs $s.)"
  fi
  say "pg_dump $c ≥ source $s — ok"
}

# ------------------------------------------------------------------------------- commands
cmd_discover() {
  say "postgres/app containers on this box"
  docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}' | awk 'NR==1 || /postgres|sinzo|app/'
  if find_db_container; then
    echo "  db container : $(docker inspect -f '{{.Name}} {{.Config.Image}} state={{.State.Status}}' "$DB_CID" | sed 's#^/##')"
    echo "  compose proj : $PROJECT"
    echo "  network      : $NET"
    echo "  host ports   : $(docker inspect -f '{{json .NetworkSettings.Ports}}' "$DB_CID")  ({} = not published, as intended)"
    if [ -n "$APP_CID" ]; then
      say "the app's own env (this is what decides which DB prod really uses)"
      docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$APP_CID" | grep -E '^(DATABASE_URL|DIRECT_URL|DEPLOY_CHANNEL|NEXT_PUBLIC_SITE_URL)=' | mask
    else
      echo "  (no running '$APP_SERVICE' service in $PROJECT — the site is served from somewhere else)"
    fi
  else
    warn "no running '$DB_SERVICE' container yet: docker compose up -d $DB_SERVICE"
  fi
  say "disk (the dump is ~the size of the DB; you want 3x free)"
  df -h "$WORKDIR" 2>/dev/null | tail -1 | sed 's/^/  /' || df -h / | tail -1 | sed 's/^/  /'
  say "config files Dokploy wrote (the Neon URL is usually in one of them)"
  grep -rl "neon.tech" /etc/dokploy/compose 2>/dev/null | sed 's/^/  /' | head -5 || echo "  (none found — you will paste the URL instead)"
}

cmd_check() {
  find_db_container || die "start the $DB_SERVICE service first (see 'discover')"
  load_src; need_dst
  gate_versions check
  say "target reachable from a sibling container?"
  sql "$DST_URL" "SELECT '  ok: '||current_setting('server_version')||' on '||current_database();" \
    || die "cannot reach $DST_DB. Is the db healthy?  docker inspect -f '{{.State.Health.Status}}' $DB_CID"
  say "source size, and what dominates it (Media stores image bytes IN the database)"
  sql "$SRC_URL" "SELECT '  database : '||pg_size_pretty(pg_database_size(current_database()))
    UNION ALL SELECT '  images   : '||count(*)||' Media rows, '||pg_size_pretty(coalesce(sum(octet_length(data)),0))||' of bytes' FROM \"Media\"
    UNION ALL SELECT '  orders   : '||count(*)||' rows, sum(total)= '||coalesce(sum(total),0)::text FROM \"Order\"
    UNION ALL SELECT '  tables   : '||count(*) FROM pg_tables WHERE schemaname='public';" \
    || die "the source query failed — read the error above (permissions? Neon suspended the branch? quota?)"
  say "emptiness of the target, and of the pre-existing '$OLD_DB' database (the merge question)"
  local fresh old
  fresh="$(sql "$(url "$DST_DB")" "SELECT count(*) FROM pg_tables WHERE schemaname='public';" 2>/dev/null | tail -1 || true)"
  echo "  $DST_DB : ${fresh:-does not exist yet} tables (want 0 or missing)"
  old="$(sql "$(url "$OLD_DB")" "SELECT count(*) FROM \"Order\";" 2>/dev/null | tail -1 || true)"
  case "${old:-}" in
    ''|*[!0-9]*) echo "  $OLD_DB  : no app schema there — nothing to merge." ;;
    0)  echo "  $OLD_DB  : schema present, 0 orders. Nothing to merge." ;;
    *)  warn "$OLD_DB already holds $old orders. Do NOT restore over it. We write to $DST_DB and merge later." ;;
  esac
  [ "${fresh:-0}" = "0" ] || [ -z "${fresh:-}" ] || die "refusing to continue: $DST_DB is not empty."
  say "check clean. Next: prep → dump → restore → verify"
}

cmd_plan() { DRY=1; cmd_prep; cmd_dump; cmd_restore; cmd_verify; echo "  (nothing was run)"; }

cmd_prep() {
  need_dst
  say "create the fresh target database '$DST_DB' owned by '$DST_OWNER'"
  local admin_exists admin_tables
  admin_exists="$(sql "$(url postgres)" "SELECT 1 FROM pg_database WHERE datname='$DST_DB';" | tail -1)"
  if [ "${admin_exists:-}" = "1" ]; then
    admin_tables="$(sql "$DST_URL" "SELECT count(*) FROM pg_tables WHERE schemaname='public';" | tail -1)"
    [ "${admin_tables:-0}" = "0" ] || die "$DST_DB exists and holds ${admin_tables:-?} tables.
   Either pick another DST_DB=... or drop it deliberately:
     docker compose -p ${PROJECT:-<project>} exec -T $DB_SERVICE dropdb -U $DST_OWNER --if-exists $DST_DB     (only if you are sure it is yours)"
    say "$DST_DB exists and is empty — continuing"
  else
    run "dc exec -T $DB_SERVICE createdb -U $DST_OWNER -O $DST_OWNER $DST_DB"
    [ "$DRY" = 1 ] || say "created"
  fi
  [ "$DRY" = 1 ] || say "tables now in $DST_DB: $(sql "$DST_URL" "SELECT count(*) FROM pg_tables WHERE schemaname='public';" | tail -1) (want 0)"
}

last_dump() { cat "$WORKDIR/.last-dump" 2>/dev/null || true; }
cmd_dump() {
  load_src; find_db_container || die "need the db container for its network"
  gate_versions dump
  mkdir -p "$WORKDIR" || die "cannot write $WORKDIR (mkdir -p it as root, or WORKDIR=/tmp/sinzo-mig)"
  local out="$WORKDIR/neon-$(date -u +%Y%m%d-%H%M%S).dump" excl="" t
  for t in $SKIP_TABLES; do excl="$excl --exclude-table-data=public.$t"; done
  [ -n "$excl" ] && say "copying schema for, but not rows of:$t"
  say "dump → $out (store stays live; pg_dump takes a consistent snapshot; this is Neon's last big egress)"
  if [ "$DRY" = 1 ]; then echo "  + pg_dump \"\$SRC_URL\" -Fc --no-sync --no-owner --no-privileges$excl > $out"; return; fi
  docker run --rm -i --network "$NET" $DOCKER_RUN_ARGS -e SRC_URL="$SRC_URL" -e EXCL="$excl" "$TOOL_IMAGE" \
    sh -c 'exec pg_dump "$SRC_URL" -Fc --no-sync --no-owner --no-privileges $EXCL' > "$out" 2>"$out.err"
  if [ ! -s "$out" ]; then warn "$(tail -3 "$out.err" 2>/dev/null)"; rm -f "$out" "$out.err"; die "dump is empty or failed — nothing was written to the target."; fi
  rm -f "$out.err"; printf '%s\n' "$out" > "$WORKDIR/.last-dump"; DUMPS="$out"
  ls -lh "$out" | awk '{print "  size "$5"  "$NF}'
  say "sha256 $(sha256sum "$out" | cut -c1-32)… — note it on the change ticket"
}

cmd_restore() {
  need_dst
  local dump="${DUMP:-$(last_dump)}"
  [ "$DRY" = 1 ] && dump="${DUMP:-$WORKDIR/neon-<ts>.dump}"
  { [ -n "$dump" ] && [ -f "$dump" ]; } || die "no dump found — run 'dump' first, or DUMP=/path/x.dump"
  local n; n="$(sql "$DST_URL" "SELECT count(*) FROM pg_tables WHERE schemaname='public';" | tail -1)"
  [ "$DRY" = 1 ] && n=0
  [ "${n:-0}" = "0" ] || die "refusing: $DST_DB holds ${n:-?} tables — a restore would clobber live rows.
   Fresh empty database only (this refusal is the safety feature)."
  say "restore $dump → $DST_DB"
  if [ "$DRY" = 1 ]; then echo "  + pg_restore -d \"\$DST_URL\" --no-owner --no-privileges -j2 < dump"; return; fi
  docker run --rm -i --network "$NET" $DOCKER_RUN_ARGS -e DST_URL="$DST_URL" -e D="/work/$(basename "$dump")" \
    -v "$(dirname "$dump"):/work:ro" "$TOOL_IMAGE" \
    sh -c 'exec pg_restore -d "$DST_URL" --no-owner --no-privileges -j2 "$D"' \
    || die "pg_restore failed. A schema error usually means the target was not empty or the role lacks CREATE on schema public:
   dc exec -T $DB_SERVICE psql -U $DST_OWNER -d $DST_DB -c 'GRANT ALL ON SCHEMA public TO $DST_OWNER;' then re-run 'restore'."
  warn "restored. A full -Fc restore does carry sequences; 'verify' proves it. Then flip the app."
}

cmd_verify() {
  load_src; need_dst
  if [ "$DRY" = 1 ]; then
    echo "  + verify: count(*) of every public table on both sides (skip rows of:${SKIP_TABLES:- none}),"
    echo "            sum(Order.total), max(Order.id), max(Order.createdAt), sum(OrderItem.price*qty),"
    echo "            sum(octet_length(Media.data)), and Order_id_seq - max(Order.id) == 0."
    echo "            any DIFF exits 1 — that is the gate on cutting over."
    return 0
  fi
  say "per-table counts (Neon vs VPS), money, freshness, sequences"
  local list="" excludes="" t; for t in $SKIP_TABLES; do list="$list'${t}',"; done; list="${list%,}"
  [ -n "$list" ] && excludes=" AND tablename NOT IN ($list)"
  local tables; tables="$(sql "$SRC_URL" "SELECT tablename FROM pg_tables WHERE schemaname='public'$excludes ORDER BY tablename;")"
  [ -n "$tables" ] || die "no tables found on the source — wrong database, or the query above errored?"
  local bad=0 a b n=0
  printf '%-22s %10s %10s  %s\n' TABLE NEON VPS OK
  while IFS= read -r t; do
    [ -n "$t" ] || continue; n=$((n+1))
    a="$(sql "$SRC_URL" "SELECT count(*) FROM \"$t\";" | tail -1)"
    b="$(sql "$DST_URL" "SELECT count(*) FROM \"$t\";" | tail -1)"
    if [ -n "$a" ] && [ "$a" = "$b" ]; then printf '%-22s %10s %10s  yes\n' "$t" "$a" "$b"
    else printf '%-22s %10s %10s  NO ←\n' "$t" "${a:-?}" "${b:-?}"; bad=1; fi
  done <<< "$tables"
  say "$n tables compared"
  local -a QS=("SELECT coalesce(sum(total),-1)::text FROM \"Order\""
               "SELECT coalesce(max(id),-1)::text FROM \"Order\""
               "SELECT coalesce(max(\"createdAt\")::text,'none') FROM \"Order\""
               "SELECT coalesce(sum(price*qty),-1)::text FROM \"OrderItem\""
               "SELECT coalesce(sum(octet_length(data)),-1)::text FROM \"Media\"")
  for q in "${QS[@]}"; do
    a="$(sql "$SRC_URL" "$q" | tail -1)"; b="$(sql "$DST_URL" "$q" | tail -1)"
    if [ -n "$a" ] && [ "$a" = "$b" ]; then printf '  ok   %s = %s\n' "$q" "$a"
    else printf '  DIFF %s  src=%s dst=%s\n' "$q" "${a:-?}" "${b:-?}"; bad=1; fi
  done
  a="$(sql "$DST_URL" "SELECT coalesce((SELECT last_value FROM pg_sequences WHERE schemaname='public' AND sequencename='Order_id_seq') - (SELECT max(id) FROM \"Order\"), -1)::text;" | tail -1)"
  if [ "${a:-x}" = "0" ]; then echo "  ok   \"Order\".id sequence = max(id) → the first new order gets a fresh id"
  else printf '  DIFF Order_id_seq minus max(id) = %s (want 0) → ./vps-migrate.sh sequences\n' "${a:-?}"; bad=1; fi
  [ "$bad" = 0 ] || die "MISMATCH — do not cut over. Paste this whole output back to me."
  say "verify clean — safe to point DATABASE_URL at $DST_DB"
}

cmd_sequences() {
  need_dst
  say "setval() every sequence to max(id) — mandatory after a data-only reload"
  sql "$DST_URL" "DO \$\$ DECLARE r RECORD; mx BIGINT; BEGIN
    FOR r IN SELECT quote_ident(n.nspname)||'.'||quote_ident(c.relname) AS tbl, a.attname AS col,
                       pg_get_serial_sequence(quote_ident(n.nspname)||'.'||quote_ident(c.relname), a.attname) AS seq
               FROM pg_attribute a
               JOIN pg_class     c ON c.oid = a.attrelid AND c.relkind IN ('r','p')
               JOIN pg_namespace n ON n.oid = c.relnamespace
              WHERE n.nspname='public' AND a.attnum > 0 AND NOT a.attisdropped
                AND pg_get_serial_sequence(quote_ident(n.nspname)||'.'||quote_ident(c.relname), a.attname) IS NOT NULL
    LOOP EXECUTE format('SELECT max(%I)::bigint FROM %s', r.col, r.tbl) INTO mx;
      IF mx IS NULL THEN PERFORM setval(r.seq, 1, false); ELSE PERFORM setval(r.seq, mx, true); END IF;
    END LOOP; END \$\$;" >/dev/null || die "the sequence pass failed — read the error above"
  sql "$DST_URL" "SELECT '  '||sequencename||' last_value='||coalesce(last_value::text,'(unset!)')
                   FROM pg_sequences WHERE schemaname='public'
                     AND sequencename IN ('Order_id_seq','OrderItem_id_seq','Product_id_seq','ProductVariant_id_seq','Customer_id_seq')
                   ORDER BY sequencename;"
}

cmd_catchup() {
  load_src; need_dst; find_db_container || die "need the db container for its network"
  warn "this TRUNCATEs and re-copies those tables on the target — the app must be stopped (Dokploy → app → Stop)."
  local listed="" want="" t
  for t in $CATCHUP_TABLES; do listed="$listed'\"$t\"',"; want="$want $t "; done; listed="${listed%,}"
  local targets; targets="$(sql "$DST_URL" "WITH RECURSIVE seed(t) AS (SELECT unnest(ARRAY[$listed]::regclass[])),
      closure(t) AS (SELECT s.t FROM seed s UNION SELECT con.conrelid::regclass FROM pg_constraint con JOIN closure c ON con.confrelid = c.t WHERE con.contype='f')
      SELECT DISTINCT 'public.'||t::text FROM closure ORDER BY 1;")"
  [ -n "$targets" ] || die "could not resolve the table list on the target — is the schema restored there?"
  local dargs="" trunc="" extra="" n=0 tt plain
  while IFS= read -r tt; do
    [ -n "$tt" ] || continue
    dargs="$dargs -t '$tt'"; trunc="$trunc ${tt#public.},"; n=$((n+1))
    plain="${tt#public.}"; plain="${plain//\"/}"
    case "$want" in *" $plain "*) ;; *) extra="$extra $plain";; esac
  done <<< "$targets"
  trunc="TRUNCATE${trunc%,};"
  [ -n "$extra" ] && warn "auto-included (they hold FKs into your list, so they must move together):$extra"
  say "delta reload: $n tables — one TRUNCATE, then a data-only COPY, in one transaction"
  if [ "$DRY" = 1 ]; then echo "  + psql \"\$DST_URL\" -qc '$trunc'"; echo "  + pg_dump \"\$SRC_URL\" --data-only --disable-triggers$dargs | psql \"\$DST_URL\" -1 -q"; return; fi
  docker run --rm -i --network "$NET" $DOCKER_RUN_ARGS -e SRC_URL="$SRC_URL" -e DST_URL="$DST_URL" \
    -e TR="$trunc" -e DA="$dargs" "$TOOL_IMAGE" \
    sh -c 'set -e; psql "$DST_URL" -v ON_ERROR_STOP=1 -qc "$TR";
           eval "pg_dump \"\$SRC_URL\" --data-only --disable-triggers $DA" | psql "$DST_URL" -1 -v ON_ERROR_STOP=1 -q' \
    || die "catchup failed. 'must be owner of table' / trigger errors → the DST role needs superuser for --disable-triggers:
     dc exec -T $DB_SERVICE psql -U $DST_OWNER -d postgres -c 'ALTER ROLE $DST_OWNER SUPERUSER'   (revoke it after)
   foreign-key errors → widen CATCHUP_TABLES."
  cmd_sequences
  say "catchup done — run 'verify' again, then start the app"
}

cmd_url() {
  need_dst
  say "paste this into Dokploy → app service → Environment"
  printf '\n  DATABASE_URL=postgresql://%s:<POSTGRES_PASSWORD>@%s:5432/%s\n' "$DST_OWNER" "$DB_SERVICE" "$DST_DB"
  printf '  DEPLOY_CHANNEL=vps\n\n'
  say "the password is this box's own db env, if you want it printed once:"
  printf '  docker inspect -f "{{range .Config.Env}}{{println .}}{{end}}" %s | grep ^POSTGRES_PASSWORD=\n\n' "${DB_CID:-\$(docker ps -q --filter label=com.docker.compose.service=$DB_SERVICE | head -1)}"
  say "delete any neon.tech DATABASE_URL/DIRECT_URL from the app env, otherwise a restart silently goes back to Neon."
  say "then: Dokploy → Deploy/restart, and ./vps-migrate.sh verify again (source has stopped moving, so it should stay clean)."
}

cmd_forget() {
  rm -f "$SRC_CACHE" && say "cached Neon URL deleted from $SRC_CACHE"
  local a="${DELETE_DUMPS:-}"
  if [ -z "$a" ]; then
    if [ -t 0 ]; then printf 'delete the dump files too? [y/N] '; IFS= read -r a; else a=keep; warn "no TTY: keeping the dumps (pass DELETE_DUMPS=1 to delete)"; fi
  fi
  case "$a" in 1|[Yy]*) rm -f "$WORKDIR"/neon-*.dump && say "dumps deleted";; *) say "dumps kept in $WORKDIR — keep at least one until Neon is paused and verify has passed twice";; esac
  say "reminder: pause — never delete — the Neon project for 7–14 days. That is the rollback."
}

case "${1:-}" in
  discover)         cmd_discover ;;
  check)            cmd_check ;;
  plan)             cmd_plan ;;
  prep)             cmd_prep ;;
  dump)             cmd_dump ;;
  restore)          cmd_restore ;;
  verify)           cmd_verify ;;
  sequences|setval) cmd_sequences ;;
  catchup)          cmd_catchup ;;
  url)              cmd_url ;;
  forget)           cmd_forget ;;
  -h|--help|help|"") sed -n '2,30p' "$0" ;;
  *) die "unknown command: $1  (discover|check|plan|prep|dump|restore|verify|catchup|sequences|url|forget)" ;;
esac
