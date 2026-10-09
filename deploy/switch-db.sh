#!/usr/bin/env bash
# Flip the app's DATABASE_URL to the VPS Postgres (or back to Neon) — with a backup, a health
# gate, and an automatic rollback if the app stops answering. This is the step people do by hand
# in the Dokploy UI and fat-finger; here the old value is always recoverable.
#
#   ./deploy/switch-db.sh --env-file .env --url 'postgresql://sinzo:PW@db:5432/sinzo_live'
#   ./deploy/switch-db.sh --rollback                    # restore the newest .env.bak-* and restart
#   ./deploy/switch-db.sh --url '…' --no-restart        # edit the file only (dry-ish run)
#
# Env file keys touched: DATABASE_URL only. Everything else in the file is left byte-identical.
# After a restart we poll $HEALTH_URL (default http://127.0.0.1:3000/api/health) for up to
# $HEALTH_WAIT seconds; if it never answers 200 we put the old .env back and restart again.
set -euo pipefail

ENV_FILE=".env"; NEW_URL=""; ROLLBACK=0; NO_RESTART=0
RESTART_CMD="${RESTART_CMD:-docker compose -f deploy/docker-compose.vps.yml up -d app}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:3000/api/health}"
HEALTH_WAIT="${HEALTH_WAIT:-60}"
VAR_NAME="${VAR_NAME:-DATABASE_URL}"

say()  { printf '\033[1;36m▸ %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m! %s\033[0m\n' "$*" >&2; }
die()  { printf '\033[1;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }
mask() { sed -E 's#(://[^:]+:)[^@]+@#\1••••••@#g'; }   # never print a password

while [ $# -gt 0 ]; do
  case "$1" in
    --env-file)   ENV_FILE="$2"; shift 2 ;;
    --url)        NEW_URL="$2"; shift 2 ;;
    --var)        VAR_NAME="$2"; shift 2 ;;
    --restart-cmd) RESTART_CMD="$2"; shift 2 ;;
    --health-url) HEALTH_URL="$2"; shift 2 ;;
    --health-wait) HEALTH_WAIT="$2"; shift 2 ;;
    --rollback)   ROLLBACK=1; shift ;;
    --no-restart) NO_RESTART=1; shift ;;
    -h|--help)    sed -n '2,15p' "$0"; exit 0 ;;
    *) die "unknown arg: $1" ;;
  esac
done

[ -f "$ENV_FILE" ] || die "$ENV_FILE not found (run from the deploy dir, or pass --env-file /path/.env)"
command -v curl >/dev/null 2>&1 || warn "no curl — health gate will be skipped"

# ── rollback mode ──────────────────────────────────────────────────────────────────────────────
if [ "$ROLLBACK" = 1 ]; then
  latest="$(ls -1t "$ENV_FILE".bak-* 2>/dev/null | head -1 || true)"
  [ -n "$latest" ] || die "no $ENV_FILE.bak-* found — nothing to roll back to"
  say "restoring $latest → $ENV_FILE"
  cp "$latest" "$ENV_FILE"
  say "DATABASE_URL is now: $(grep -E "^${VAR_NAME}=" "$ENV_FILE" | cut -d= -f2- | mask || echo '(not set)')"
  if [ "$NO_RESTART" = 0 ]; then
    bash -lc "$RESTART_CMD" || warn "restart command failed — the file is already rolled back, restart manually"
    sleep 3
    curl -fsS -o /dev/null --max-time 10 "$HEALTH_URL" && say "health: 200 after rollback ✓" \
      || warn "health endpoint not answering — check the container yourself"
  fi
  exit 0
fi

[ -n "$NEW_URL" ] || die "--url is required (or use --rollback). List of backups: ls -1 $ENV_FILE.bak-*"
case "$NEW_URL" in
  postgresql://*|postgres://*) ;;
  *) die "refusing: $VAR_NAME should look like postgresql://user:pass@host:5432/db — got something else.
   (If you meant to paste the Neon API/PostgREST URL: /rest/v1 is a row API, not a connection string.)" ;;
esac

# ── remember the current value, then write the new one ─────────────────────────────────────────
OLD="$(grep -E "^${VAR_NAME}=" "$ENV_FILE" | tail -1 | cut -d= -f2- || true)"
if [ -z "$OLD" ]; then
  OLD_LINE="${VAR_NAME}=\"${NEW_URL}\""
  warn "$VAR_NAME is not in $ENV_FILE yet — appending it"
else
  OLD_LINE="$OLD"
fi
bak="$ENV_FILE.bak-$(date -u +%Y%m%d-%H%M%S)"
cp -p "$ENV_FILE" "$bak"
say "backup: $bak"
say "old ${VAR_NAME}: $(printf '%s' "$OLD_LINE" | mask)"
say "new ${VAR_NAME}: $(printf '%s' "$NEW_URL" | mask)"

# rewrite in place without sed's -i portability drama: build a temp and move it back
tmp="$(mktemp)"
awk -v name="$VAR_NAME" -v val="$NEW_URL" '
  BEGIN { done = 0 }
  { if ($0 ~ "^"name"=") { if (!done) { print name "=\"" val "\""; done = 1 } ; next }
    print }
  END { if (!done) print name "=\"" val "\"" }
' "$ENV_FILE" > "$tmp"
mv "$tmp" "$ENV_FILE"
grep -qE "^${VAR_NAME}=\"?${NEW_URL%%\?*}" "$ENV_FILE" || die "write did not take effect — check file permissions"
say "$ENV_FILE updated ($(grep -c '' "$ENV_FILE") lines, only ${VAR_NAME} touched)"

# ── restart + health gate ──────────────────────────────────────────────────────────────────────
if [ "$NO_RESTART" = 1 ]; then
  warn "--no-restart: file changed, app NOT restarted. Rollback if needed: $0 --rollback"
  exit 0
fi
say "restarting: $RESTART_CMD"
bash -lc "$RESTART_CMD" || { warn "restart command failed"; }
say "waiting up to ${HEALTH_WAIT}s for $HEALTH_URL"
ok=0
end=$((SECONDS + HEALTH_WAIT))
while [ $SECONDS -lt $end ]; do
  if curl -fsS -o /dev/null --max-time 5 "$HEALTH_URL" 2>/dev/null; then ok=1; break; fi
  sleep 2
done
if [ "$ok" = 1 ]; then
  say "health 200 ✓ — app is up on the new database"
  say "now confirm the app really reads/writes there: docker compose exec -T db psql -U sinzo -d sinzo_live -Atc 'select count(*) from \"Order\"'"
  say "if anything looks wrong: $0 --rollback   (backup kept at $bak)"
  exit 0
fi
warn "health never answered — rolling back automatically"
cp -p "$bak" "$ENV_FILE"
bash -lc "$RESTART_CMD" >/dev/null 2>&1 || true
die "rolled back to $(printf '%s' "$OLD_LINE" | mask) (health gate failed). Check 'docker compose logs app' before retrying."
