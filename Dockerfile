# Production container (see docker-compose.yml for full stack with PostgreSQL)
FROM node:20-bookworm-slim AS deps
RUN apt-get update -qq && apt-get install -y -qq openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json* ./
# prisma schema needed for the postinstall `prisma generate` (use PROD schema: postgresql + correct binaryTargets)
COPY prisma ./prisma
RUN npm ci --ignore-scripts && npx prisma generate --schema prisma/schema.prod.prisma && npm rebuild sharp --foreground-scripts

FROM node:20-bookworm-slim AS builder
RUN apt-get update -qq && apt-get install -y -qq openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# cap Node heap so `next build` fits in small VPS RAM (2GB, no swap by default)
ENV NODE_OPTIONS=--max-old-space-size=614
# production build uses the PostgreSQL schema (same as `npm run build` script)
# Catalogue/admin routes render at request time. Do not pass live DB credentials
# as build arguments (they leak through image provenance/cache metadata).
# DATABASE_URL is supplied only to the running container.
# minimize build-time memory: no webpack cache, single worker
ENV WEBPACK_CACHE=false NEXT_PRIVATE_WORKER_THREADS=1
RUN npx prisma generate --schema prisma/schema.prod.prisma && npm run build

FROM node:20-bookworm-slim AS runner
# util-linux provides setpriv, which the entrypoint uses to drop from root to the app
# user AFTER it has fixed ownership of the mounted uploads volume (see below).
RUN apt-get update -qq && apt-get install -y -qq openssl util-linux && rm -rf /var/lib/apt/lists/* \
 && groupadd --system --gid 1001 sinzo \
 && useradd --system --uid 1001 --gid sinzo --home-dir /app --shell /usr/sbin/nologin sinzo
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/public ./public
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/prisma ./prisma
# The entrypoint needs the schema safety net after runtime DATABASE_URL is set.
COPY --from=builder /app/scripts/ensure-db.js ./scripts/ensure-db.js
COPY --from=builder /app/scripts/abandoned-worker.js ./scripts/abandoned-worker.js
COPY --from=builder /app/next.config.mjs ./next.config.mjs
# entrypoint: runs prisma/migrate-from-neon.js first when MIGRATE_ON_BOOT is set in the panel, then the app
COPY --from=builder /app/docker-entrypoint.sh /usr/local/bin/sinzo-entrypoint.sh
# The app only needs to write inside public/uploads (WhatsApp media) — everything else is
# read-only at runtime. Owning the tree as the unprivileged user is what lets the container
# stop running as root without breaking uploads.
RUN chmod +x /usr/local/bin/sinzo-entrypoint.sh \
 && mkdir -p /app/public/uploads/wa \
 && chown -R sinzo:sinzo /app
EXPOSE 3000
# Deliberately NOT `USER sinzo`: the entrypoint has to start as root so it can chown a
# pre-existing, root-owned `uploads:` volume from an earlier deployment, and it drops to
# sinzo itself with setpriv before exec'ing the app. A brand-new deployment never needs
# that step, and an upgrade heals on the first boot instead of failing every upload.
ENTRYPOINT ["/usr/local/bin/sinzo-entrypoint.sh"]
# ensure DB columns on container start (runs before next start)
CMD ["npm", "run", "start"]
