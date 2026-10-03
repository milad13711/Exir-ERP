# Multi-stage build for the Exir ERP backend core, used both for the shared
# cloud deployment and for on-premise bundles — see docs/ON_PREMISE.md.
# Build context must be the repo root: `docker build -f apps/backend-core/Dockerfile .`
#
# The final image keeps devDependencies (tsx, the prisma CLI, typescript)
# rather than pruning to production-only: docker-entrypoint.sh runs the
# Control Plane migration+seed and the on-premise bootstrap script on every
# boot, and those need tsx/prisma present. Simplicity and a working
# entrypoint win over a few extra megabytes here.

FROM node:20-alpine AS deps
WORKDIR /app
# dl-cdn.alpinelinux.org is unreachable from some networks (same class of
# issue as NPM_REGISTRY below) — override with e.g.
# --build-arg ALPINE_MIRROR=https://mirror.yandex.ru/mirrors/alpine
ARG ALPINE_MIRROR=https://dl-cdn.alpinelinux.org/alpine
RUN sed -i "s#https://dl-cdn.alpinelinux.org/alpine#${ALPINE_MIRROR}#g" /etc/apk/repositories \
 && apk add --no-cache openssl
# Some networks (notably inside Iran) block registry.npmjs.org outright —
# override with e.g. --build-arg NPM_REGISTRY=https://mirror-npm.runflare.com
ARG NPM_REGISTRY=https://registry.npmjs.org
RUN npm config set registry "$NPM_REGISTRY"
COPY apps/backend-core/package.json apps/backend-core/package-lock.json ./
# Puppeteer's own bundled Chromium is a glibc binary and won't run on
# Alpine's musl libc — skip its download here and use the apk-installed
# system Chromium in the runtime stage instead (PUPPETEER_EXECUTABLE_PATH).
ENV PUPPETEER_SKIP_DOWNLOAD=true
RUN npm ci

FROM node:20-alpine AS build
WORKDIR /app
ARG ALPINE_MIRROR=https://dl-cdn.alpinelinux.org/alpine
RUN sed -i "s#https://dl-cdn.alpinelinux.org/alpine#${ALPINE_MIRROR}#g" /etc/apk/repositories \
 && apk add --no-cache openssl
COPY --from=deps /app/node_modules ./node_modules
COPY apps/backend-core/ ./
RUN npx prisma generate --schema prisma/control/schema.prisma \
 && npx prisma generate --schema prisma/tenant/schema.prisma \
 && npm run build

FROM node:20-alpine AS runtime
WORKDIR /app
# chromium here is the system browser used by the invoice-PDF renderer
# (src/billing/invoice-pdf.service.ts) — Puppeteer's own download is
# skipped above since it ships a glibc binary incompatible with musl.
# postgresql-client provides pg_dump for the settings → backup download and the
# daily backup cron (src/settings/backup.service.ts) — a real full-schema dump.
# dl-cdn.alpinelinux.org is unreachable from some networks (same class of
# issue as NPM_REGISTRY above) — override with e.g.
# --build-arg ALPINE_MIRROR=https://mirror.yandex.ru/mirrors/alpine
ARG ALPINE_MIRROR=https://dl-cdn.alpinelinux.org/alpine
RUN sed -i "s#https://dl-cdn.alpinelinux.org/alpine#${ALPINE_MIRROR}#g" /etc/apk/repositories \
 && apk add --no-cache openssl chromium postgresql-client
ENV NODE_ENV=production
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/generated ./generated
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x docker-entrypoint.sh \
 && addgroup -S exir && adduser -S exir -G exir \
 && chown -R exir:exir /app
USER exir
EXPOSE 3001
ENTRYPOINT ["./docker-entrypoint.sh"]
