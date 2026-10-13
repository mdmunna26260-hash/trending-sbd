#!/bin/sh
# SINZO container entrypoint.
#
# It exists for one reason: to give the box a place to run one-shot maintenance BEFORE the app binds :3000,
# without needing SSH, a host shell, or a `docker exec`. Dokploy's panel can set environment variables and
# click Deploy — that is the whole interface a non-terminal user has.
#
#   MIGRATE_ON_BOOT=full   copy Neon → the VPS database while the shop still runs on Neon (see prisma/migrate-from-neon.js)
#   MIGRATE_ON_BOOT=final  last delta, during the deploy that already points DATABASE_URL at the VPS database
#
# Everything here is deliberately best-effort: a failing maintenance step must never keep the shop down.
# With MIGRATE_ON_BOOT unset (the normal case) this is exactly what the old CMD did, plus `exec` so the app
# receives SIGTERM properly instead of leaving `npm` as PID 1.

set -u

MIGRATE_MARKER="${MIGRATE_MARKER:-/tmp/sinzo-cutover.url}"

if [ -n "${MIGRATE_ON_BOOT:-}" ] && [ "$MIGRATE_ON_BOOT" != "0" ] && [ "$MIGRATE_ON_BOOT" != "off" ]; then
  echo "[boot] MIGRATE_ON_BOOT=$MIGRATE_ON_BOOT — running prisma/migrate-from-neon.js before the app starts"
  node prisma/migrate-from-neon.js || echo "[boot] migration exited non-zero (see the log above) — starting the app anyway"
  echo "[boot] migration phase finished"
fi

# A successful MIGRATE_ON_BOOT=cutover leaves this file behind. It is what the app boots on from now on, so
# the panel edit can happen later without the shop ever coming up on the old database in between.
if [ -s "$MIGRATE_MARKER" ]; then
  NEW_URL=$(cat "$MIGRATE_MARKER")
  case "$NEW_URL" in
    postgres*)
      [ "$NEW_URL" != "${DATABASE_URL:-}" ] && echo "[boot] DATABASE_URL switched for this process (cutover marker: $MIGRATE_MARKER)"
      export DATABASE_URL="$NEW_URL" ;;
    *) echo "[boot] ignoring malformed $MIGRATE_MARKER" ;;
  esac
fi

# Make sure newly added columns exist against the runtime database before serving requests.
[ -f scripts/ensure-db.js ] && node scripts/ensure-db.js

# ---------------------------------------------------------------------------
# Drop privileges.
#
# The image used to run Next.js as root. Any file-read or RCE bug in the app or
# in a dependency then owned the whole container, the mounted uploads volume and
# whatever secrets the runtime environment carried.
#
# This runs LAST, and as root, for one reason: the `uploads:` named volume from an
# existing deployment is root-owned. If the container simply switched to an
# unprivileged USER, WhatsApp media writes would start failing the moment the new
# image shipped — a broken shop is worse than a root shop. So the entrypoint fixes
# ownership first and only then hands the process to uid 1001.
#
# If setpriv or the sinzo user is missing (someone rebuilt the image differently),
# this degrades to the old behaviour rather than failing to boot.
# ---------------------------------------------------------------------------
APP_UID="${APP_UID:-1001}"
APP_USER="${APP_USER:-sinzo}"
if [ "$(id -u)" = "0" ] && command -v setpriv >/dev/null 2>&1 && id "$APP_USER" >/dev/null 2>&1; then
  # Only the directory the app actually writes to; chowning all of /app every boot
  # would be slow and would fight the image's own ownership.
  mkdir -p /app/public/uploads/wa
  chown -R "$APP_UID:$APP_UID" /app/public/uploads 2>/dev/null || echo "[boot] could not chown uploads — uploads may fail"
  # npm/next want a writable cache + tmp even as an unprivileged user.
  chown "$APP_UID:$APP_UID" /tmp 2>/dev/null || true
  echo "[boot] dropping privileges to $APP_USER (uid $APP_UID)"
  exec setpriv --reuid="$APP_UID" --regid="$APP_UID" --init-groups -- "$@"
fi
if [ "$(id -u)" = "0" ]; then
  echo "[boot] WARNING: running as root — setpriv or user '$APP_USER' unavailable in this image"
fi

exec "$@"
