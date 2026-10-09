#!/usr/bin/env bash
# Move the SINZO database from Neon onto the self-hosted Postgres on the VPS.
# Companion to deploy/NEON-TO-VPS.md — read that first, it has the Dokploy/DNS/webhook steps.
#
# ⚠ Not usable against the current source: Neon is on Postgres 18 (measured 2026-09-17) and this script's
#   client tools come from the postgres:16-alpine `db` image, so `pg_dump` would abort on version mismatch.
#   Use deploy/vps-migrate.sh instead — same phases, but it runs the tools in a postgres:18-alpine container
#   on the db service's network and finds Dokploy's compose project by itself.
#
#   ./deploy/neon-to-vps.sh precheck     sizes + row counts on both sides; changes nothing
#   ./deploy/neon-to-vps.sh dump         pg_dump SRC → backup/neon-<ts>.dump   (-Fc, --no-sync)
#   ./deploy/neon-to-vps.sh restore      pg_restore into DST (refuses a non-empty DST)
#   ./deploy/neon-to-vps.sh catchup      final delta: --truncate reload of the busy tables only
#   ./deploy/neon-to-vps.sh sequences    setval() every sequence to max(id) — needed after a
#                                data-only reload; a full pg_dump -Fc restore already does this
#   ./deploy/neon-to-vps.sh verify       exact count(*) per table + money/freshness/sequence check
#   ./deploy/neon-to-vps.sh all          dump → restore → sequences → verify
#   ./deploy/neon-to-vps.sh plan         dry-run: print every command, run none
#
# Required env:
#   SRC_URL   Neon, use the DIRECT (non-pooled) endpoint for dumps:
#             postgresql://USER:PASSWORD@DIRECT_NEON_HOST/DATABASE?sslmode=require
#   DST_URL   VPS target — point at a FRESH empty database first, e.g.
#             postgresql://sinzo:PASS@127.0.0.1:5432/sinzo_live
#
# Optional env:
#   RUNNER=auto|host|container   how client tools are found. "container" pipes through
#                                `docker compose exec -T $DB_SERVICE`, so a VPS with no psql
#                                installed still works (the postgres:16 image has them).
#   DB_SERVICE=db                compose service providing the client tools
#   WORKDIR=./backup             where dumps land
#   SKIP_TABLES=""               tables to omit from the dump, e.g. "TrackingEvent AuditLog"
#   CATCHUP_TABLES='…'           tables re-copied by `catchup` — PARENT FIRST, children last
#                                (default: Order OrderItem Product ProductVariant Customer …)
#   AUTO_SEQUENCES=1             catchup also runs the setval pass (it must: a data-only reload
#                                copies explicit ids and never touches sequences). Set 0 to skip.
#   FORCE_RESTORE=0              1 = allow restore into a non-empty DST (--clean --if-exists)
#   DUMP=/path/x.dump            reuse an existing dump instead of making a new one
#
# Nothing here deletes anything on the source. Neon stays exactly as it was — that is the rollback.
set -euo pipefail

SRC_URL="${SRC_URL:-}"; DST_URL="${DST_URL:-}"
RUNNER="${RUNNER:-auto}"; DB_SERVICE="${DB_SERVICE:-db}"
WORKDIR="${WORKDIR:-./backup}"; SKIP_TABLES="${SKIP_TABLES:-}"; FORCE_RESTORE="${FORCE_RESTORE:-0}"
CATCHUP_TABLES="${CATCHUP_TABLES:-Order OrderItem Product ProductVariant Customer Coupon Review InventoryMovement AbandonedCheckout PushSubscription}"
TS="$(date -u +%Y%m%d-%H%M%S)"; DRY=0
RUNNER_RESOLVED=""

say()  { printf '\033[1;36m▸ %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m! %s\033[0m\n' "$*" >&2; }
die()  { printf '\033[1;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

pick_runner() {
  [ -n "$RUNNER_RESOLVED" ] && return
  case "$RUNNER" in
    host)      RUNNER_RESOLVED=host ;;
    container) RUNNER_RESOLVED=container ;;
    auto)
      if command -v docker >/dev/null 2>&1 && [ -n "$(docker compose ps -q "$DB_SERVICE" 2>/dev/null || true)" ]; then
        RUNNER_RESOLVED=container
      elif command -v psql >/dev/null 2>&1; then
        RUNNER_RESOLVED=host
      else
        die "no psql on this host and no running '$DB_SERVICE' compose service.
   Either: docker compose up -d $DB_SERVICE      (tools come from the postgres:16 image)
   Or:   apt-get install -y postgresql-client"
      fi ;;
    *) die "RUNNER must be auto|host|container (got: $RUNNER)" ;;
  esac
  if [ "$RUNNER_RESOLVED" = "container" ]; then say "client tools via: docker compose exec -T $DB_SERVICE" >&2
  else say "client tools via: host psql/pg_dump" >&2; fi
}

# sql <url> <statement> → raw rows on stdout (works in host and container mode: URL is argv)
sql() {
  local url="$1" q="$2"
  pick_runner
  if [ "$RUNNER_RESOLVED" = "container" ]; then
    printf '%s' "$q" | docker compose exec -T "$DB_SERVICE" psql "$url" -v ON_ERROR_STOP=1 -Atq
  else
    printf '%s' "$q" | psql "$url" -v ON_ERROR_STOP=1 -Atq
  fi
}

skip_flags() { local t out=""; for t in $SKIP_TABLES; do out="$out --exclude-table-data=public.$t"; done; printf '%s' "$out"; }
skip_list()  { local t out=""; for t in $SKIP_TABLES; do out="$out'${t}',"; done; printf '%s' "${out%,}"; }
need_src()  { [ -n "$SRC_URL" ] || die "SRC_URL (the Neon URL) is not set"; }
need_dst()  { [ -n "$DST_URL" ] || die "DST_URL (the VPS target) is not set"; }
need_both() { need_src; [ -n "$DST_URL" ] || die "DST_URL (the VPS target) is not set"; }
dumpfile()  { local f="${DUMP:-}"; [ -n "$f" ] || f="$(cat "$WORKDIR/.last-dump" 2>/dev/null || true)"; printf '%s' "$f"; }

cmd_precheck() {
  need_src
  # pg_dump refuses a source newer than its own major version, so check before anything else:
  # our compose image is postgres:16-alpine → fine for Neon PG ≤ 16; for a PG 17 branch/upgrade
  # bump the tool image (or run the same commands from a postgres:17-alpine container).
  say "Postgres versions (pg_dump on the SOURCE side must be >= the server's major)"
  client_version="$(pick_runner >/dev/null 2>&1; if [ "$RUNNER_RESOLVED" = "container" ]; then docker compose exec -T "$DB_SERVICE" pg_dump --version 2>/dev/null; else pg_dump --version 2>/dev/null; fi | head -1)"
  say "pg_dump in use: ${client_version:-unknown}"
  sql "$SRC_URL" "SELECT '  source (Neon) server: '||current_setting('server_version')||'  (needs a client of this major or newer)';" 2>/dev/null \
    || warn "could not read the source version — is SRC_URL the direct (non-pooled) endpoint?"
  if [ -n "$DST_URL" ]; then
    sql "$DST_URL" "SELECT '  target (VPS)   server: '||current_setting('server_version');" 2>/dev/null || true
  fi
  say "SOURCE (Neon) — total size and what dominates it (Media stores image BYTES in the DB)"
  sql "$SRC_URL" "SELECT 'database   : '||pg_size_pretty(pg_database_size(current_database()))
                  UNION ALL SELECT 'image rows : '||count(*)||' rows, '||pg_size_pretty(coalesce(sum(octet_length(data)),0))||' stored in \"Media\".data' FROM \"Media\"
                  UNION ALL SELECT 'orders     : '||count(*)||' rows, sum(total)= '||coalesce(sum(total),0)::text FROM \"Order\"
                  UNION ALL SELECT 'biggest tables:'
                  UNION ALL SELECT '   '||line FROM (
                      SELECT relname||' → '||pg_size_pretty(pg_total_relation_size(relid))||', ~'||coalesce(n_live_tup,0)::text||' rows (estimate)' AS line
                      FROM pg_stat_user_tables ORDER BY pg_total_relation_size(relid) DESC NULLS LAST LIMIT 8) q;"
  if [ -n "$DST_URL" ]; then
    say "TARGET (VPS) — what already exists there"
    sql "$DST_URL" "SELECT 'database    : '||pg_size_pretty(pg_database_size(current_database()))
                    UNION ALL SELECT 'public tables: '||count(*) FROM pg_tables WHERE schemaname='public'
                    UNION ALL SELECT 'orders there : '||(SELECT count(*) FROM \"Order\") ;" 2>/dev/null \
      || say "target has no schema yet — that is exactly what we want for a fresh restore."
  else
    warn "DST_URL not set — showing source only."
  fi
}

cmd_dump() {
  need_src
  mkdir -p "$WORKDIR"
  local out="$WORKDIR/neon-$TS.dump"
  say "dump → $out"
  if [ "$DRY" = 1 ]; then
    echo "  pg_dump \"\$SRC_URL\" -Fc --no-sync --no-owner --no-privileges$(skip_flags) > $out"; return
  fi
  pick_runner
  if [ "$RUNNER_RESOLVED" = "container" ]; then
    docker compose exec -T "$DB_SERVICE" pg_dump "$SRC_URL" -Fc --no-sync --no-owner --no-privileges $(skip_flags) > "$out"
  else
    pg_dump "$SRC_URL" -Fc --no-sync --no-owner --no-privileges $(skip_flags) -f "$out"
  fi
  [ -s "$out" ] || die "dump is empty — check SRC_URL (and that you used the DIRECT endpoint)"
  printf '%s\n' "$out" > "$WORKDIR/.last-dump"
  ls -lh "$out" | awk '{print "  size "$5"  "$NF}'
  say "sha256: $(sha256sum "$out" | cut -c1-24)…  (note it on the change ticket)"
}

cmd_restore() {
  need_both
  local dump; dump="$(dumpfile)"
  if [ "$DRY" = 1 ] && { [ -z "$dump" ] || [ ! -f "$dump" ]; }; then
    echo "  (then) pg_restore -d "\$DST_URL" --no-owner --no-privileges -j2 backup/neon-<ts>.dump"; return
  fi
  { [ -n "$dump" ] && [ -f "$dump" ]; } || die "no dump found — run 'dump' first or set DUMP=/path/x.dump"
  if [ "$DRY" = 1 ]; then echo "  (then) pg_restore -d \"\$DST_URL\" --no-owner --no-privileges -j2 backup/neon-<ts>.dump"; return; fi
  if [ "$FORCE_RESTORE" != "1" ]; then
    local n; n="$(sql "$DST_URL" "SELECT count(*) FROM pg_tables WHERE schemaname='public';" 2>/dev/null || echo 0)"
    [ "${n:-0}" = "0" ] || die "target already holds $n tables — refusing to overwrite.
   Point DST_URL at a fresh empty database (recommended), or FORCE_RESTORE=1 to drop-and-replace
   (whatever orders the VPS already has would be lost)."
  fi
  say "restore $dump → target"
  if [ "$DRY" = 1 ]; then echo "  pg_restore -d \"\$DST_URL\" --no-owner --no-privileges -j2 $dump"; return; fi
  pick_runner
  if [ "$RUNNER_RESOLVED" = "container" ]; then
    docker compose exec -T "$DB_SERVICE" pg_restore -d "$DST_URL" --no-owner --no-privileges -j2 < "$dump"
  else
    pg_restore -d "$DST_URL" --no-owner --no-privileges -j2 "$dump"
  fi
  warn "restore done — sequences are still wrong. Run 'sequences' before the app writes anything."
}

IFS= read -r -d '' CLOSURE_SQL_TMPL <<'CLOSURESQL' || true
WITH RECURSIVE seed(t) AS (
  SELECT unnest(ARRAY[LIST]::regclass[])
), closure(t) AS (
  SELECT s.t FROM seed s
  UNION
  SELECT con.conrelid::regclass FROM pg_constraint con JOIN closure c ON con.confrelid = c.t WHERE con.contype = 'f'
)
SELECT DISTINCT 'public.'||t::text FROM closure ORDER BY 1;
CLOSURESQL

cmd_catchup() {
  need_both
  # pg_dump/pg_restore have no --truncate in PG ≤ 17, so the reload is explicit:
  # one TRUNCATE over the whole set, then a data-only COPY parent-first in one transaction.
  local listed="" t want=""
  for t in $CATCHUP_TABLES; do listed="$listed'\"$t\"',"; want="$want ${t} "; done; listed="${listed%,}"
  local targets
  targets="$(sql "$DST_URL" "${CLOSURE_SQL_TMPL/LIST/$listed}")"
  [ -n "$targets" ] || die "could not resolve the table list on the target — is the schema restored there?"
  local dumpargs="" trunc="" extra="" n=0 tt
  while IFS= read -r tt; do
    [ -n "$tt" ] || continue
    dumpargs="$dumpargs -t '$tt'"          # single quotes: this string is re-parsed by an inner bash -lc
    trunc="$trunc ${tt#public.},"
    n=$((n+1))
    plain="${tt#public.}"; plain="${plain//\"/}"
    case " $want " in *" $plain "*) ;; *) extra="$extra $plain";; esac
  done <<< "$targets"
  trunc="TRUNCATE${trunc%,};"
  [ -n "$extra" ] && warn "auto-included (they hold FKs pointing at your list, so they must move together):$extra"
  say "delta reload: $n tables — truncate in one command, then COPY, in one transaction"
  if [ "$DRY" = 1 ]; then
    echo "  psql "\$DST_URL" -v ON_ERROR_STOP=1 -qc '$trunc'"; echo "  pg_dump "\$SRC_URL" --data-only --disable-triggers$dumpargs | psql "\$DST_URL" -1 -q"; return
  fi
  pick_runner
  local pre="psql "\$DST_URL" -v ON_ERROR_STOP=1 -qc '$trunc'"
  local load="pg_dump "\$SRC_URL" --data-only --disable-triggers$dumpargs | psql "\$DST_URL" -1 -v ON_ERROR_STOP=1 -q"
  if [ "$RUNNER_RESOLVED" = "container" ]; then
    docker compose exec -T -e SRC_URL="$SRC_URL" -e DST_URL="$DST_URL" "$DB_SERVICE" bash -lc "$pre && $load" \
      || die "catchup failed. If it is about triggers, the DST role needs superuser (pg_dump --disable-triggers).
   If it is about a foreign key, that table is missing from the closure — re-run with a wider CATCHUP_TABLES."
  else
    SRC_URL="$SRC_URL" DST_URL="$DST_URL" bash -lc "$pre && $load" \
      || die "catchup failed — see the message above (triggers → DST role needs superuser; FK → widen CATCHUP_TABLES)."
  fi
  if [ "${AUTO_SEQUENCES:-1}" = "1" ]; then
    say "a data-only reload copies explicit ids and leaves sequences behind — fixing them now"
    cmd_sequences
  else
    warn "AUTO_SEQUENCES=0 — run 'sequences' before the app writes to this DB."
  fi
}

# setval every sequence to the highest id present. A full `pg_dump -Fc` restore already embeds
# these; a --data-only reload does NOT — that is exactly the case that produces duplicate-key
# errors on the first new order after a cutover.
IFS= read -r -d '' SEQ_SQL <<'SEQSQL' || true
DO $$
DECLARE r RECORD; mx BIGINT;
BEGIN
  FOR r IN
    SELECT DISTINCT
           quote_ident(n.nspname)||'.'||quote_ident(c.relname) AS tbl,
           a.attname AS col,
           pg_get_serial_sequence(quote_ident(n.nspname)||'.'||quote_ident(c.relname), a.attname) AS seq
    FROM pg_attribute a
    JOIN pg_class     c ON c.oid = a.attrelid AND c.relkind IN ('r','p')
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND a.attnum > 0 AND NOT a.attisdropped
      AND pg_get_serial_sequence(quote_ident(n.nspname)||'.'||quote_ident(c.relname), a.attname) IS NOT NULL
  LOOP
    EXECUTE format('SELECT max(%I)::bigint FROM %s', r.col, r.tbl) INTO mx;
    IF mx IS NULL THEN
      PERFORM setval(r.seq, 1, false);
      RAISE NOTICE '% → 1 (table % empty)', r.seq, r.tbl;
    ELSE
      PERFORM setval(r.seq, mx, true);
      RAISE NOTICE '% → %', r.seq, mx;
    END IF;
  END LOOP;
END $$;
SEQSQL

cmd_sequences() {
  need_dst   # only the target is touched here — it must work standalone for post-cutover fixes
  say "setval() — skip this and the first new order collides with a migrated primary key"
  sql "$DST_URL" "$SEQ_SQL" >/dev/null
  say "spot-check (sequences on the tables that hand out ids)"
  # pg_sequences exposes sequencename/last_value (no table column) — our names are always <Table>_id_seq
  sql "$DST_URL" "SELECT '  '||sequencename||' last_value='||coalesce(last_value::text,'(unset — fix it!)')
                  FROM pg_sequences WHERE schemaname='public'
                    AND sequencename IN ('Order_id_seq','OrderItem_id_seq','Product_id_seq','ProductVariant_id_seq','Customer_id_seq')
                  ORDER BY sequencename;" || say "(pg_sequences not readable for this role — harmless, the safety check below covers it)"
}

cmd_verify() {
  need_both
  say "exact row counts, per table"
  local excludes="" list; list="$(skip_list)"
  [ -n "$list" ] && excludes=" AND tablename NOT IN ($list)"
  local tables; tables="$(sql "$SRC_URL" "SELECT tablename FROM pg_tables WHERE schemaname='public'$excludes ORDER BY tablename;")"
  [ -n "$tables" ] || die "no tables found on the source — restore/verify against the wrong database?"
  local bad=0 t a b
  printf '%-22s %10s %10s  %s\n' TABLE NEON VPS OK
  while IFS= read -r t; do
    [ -n "$t" ] || continue
    a="$(sql "$SRC_URL" "SELECT count(*) FROM \"$t\";" 2>/dev/null || echo ?)"
    b="$(sql "$DST_URL" "SELECT count(*) FROM \"$t\";" 2>/dev/null || echo ?)"
    if [ "$a" = "?" ] || [ "$b" = "?" ]; then printf '%-22s %10s %10s  ERR ←\n' "$t" "$a" "$b"; bad=1
    elif [ "$a" = "$b" ]; then printf '%-22s %10s %10s  yes\n' "$t" "$a" "$b"
    else printf '%-22s %10s %10s  NO ←\n' "$t" "$a" "$b"; bad=1; fi
  done <<< "$tables"
  say "money + freshness (equal counts with a wrong sum means a broken restore)"
  local -a QS=(
    "SELECT coalesce(sum(total),-1)::text FROM \"Order\""
    "SELECT coalesce(max(id),-1)::text FROM \"Order\""
    "SELECT coalesce(max(\"createdAt\")::text,'none') FROM \"Order\""
    "SELECT coalesce(sum(price*qty),-1)::text FROM \"OrderItem\""
  )
  for q in "${QS[@]}"; do
    a="$(sql "$SRC_URL" "$q" 2>/dev/null || echo ?)"; b="$(sql "$DST_URL" "$q" 2>/dev/null || echo ?)"
    if [ "$a" = "?" ] || [ "$b" = "?" ]; then printf '  ERR  %s — query failed on one side\n' "$q"; bad=1
    elif [ "$a" = "$b" ]; then printf '  ok   %s = %s\n' "$q" "$a"
    else printf '  DIFF %s  src=%s dst=%s\n' "$q" "$a" "$b"; bad=1; fi
  done
  # non-mutating on purpose: nextval() would burn an id on every verify run
  say "sequence safety: sequence last_value must have caught up with max(id)"
  a="$(sql "$DST_URL" "SELECT coalesce((SELECT last_value FROM pg_sequences WHERE schemaname='public' AND sequencename='Order_id_seq') - (SELECT max(id) FROM \"Order\"), -1)::text;" 2>/dev/null || echo ?)"
  if [ "$a" = "0" ]; then echo "  ok   \"Order\".id sequence = max(id) — new orders get fresh ids"
  else printf '  DIFF "Order".id sequence minus max(id) = %s (want 0) — run %s\n' "$a" "'sequences'"; bad=1; fi
  [ "$bad" = 0 ] || die "MISMATCH — do not cut over yet."
  say "verify clean — safe to point DATABASE_URL at this database."
}

case "${1:-}" in
  precheck) cmd_precheck ;;
  dump)     cmd_dump ;;
  restore)  cmd_restore ;;
  catchup)  cmd_catchup ;;
  sequences|setval) cmd_sequences ;;
  verify)   cmd_verify ;;
  plan)     DRY=1; need_src; cmd_dump; cmd_restore; cmd_catchup; cmd_sequences; cmd_verify ;;
  all)      need_both; cmd_dump; cmd_restore; cmd_sequences; cmd_verify ;;
  ""|-h|--help|help) sed -n '2,36p' "$0" ;;
  *) die "unknown command: $1  (precheck|dump|restore|catchup|sequences|verify|all|plan)" ;;
esac
