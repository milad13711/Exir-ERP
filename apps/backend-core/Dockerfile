# Multi-stage build for the Exir ERP backend core, used both for the shared
# cloud deployment and for on-premise bundles — see docs/ON_PREMISE.md.
# Build context must be the repo root: `docker build -f apps/backend-core/Dockerfile .`
#
# The final image carries production dependencies PLUS tsx (the prisma CLI is
# already a production dependency): docker-entrypoint.sh runs the Control Plane
# migration+seed and the on-premise bootstrap script on every boot, and those
# need tsx/prisma present. Everything else from devDependencies (typescript,
# nest CLI, vitest, ...) is left out: the full tree was ~3 GB and a build on the
# 24 GB production disk ran out of space (2026-10-20).

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

# Build stage reuses the deps layers (no second 1.5 GB copy of node_modules).
FROM deps AS build
COPY apps/backend-core/ ./
RUN npx prisma generate --schema prisma/control/schema.prisma \
 && npx prisma generate --schema prisma/tenant/schema.prisma \
 && npm run build

# مانیفست یکپارچگی امضاشده (SHA-256 همه‌ی فایل‌های dist). کلید امضا فقط به‌صورت BuildKit secret داده می‌شود و در هیچ لایه‌ای نمی‌ماند:
#   docker build --secret id=license_signing_key,src=keys/<kid>.private.pem [--secret id=license_signing_passphrase,src=pass.txt] ...
# بدون secret بیلد **خطا می‌دهد** مگر صریحاً --build-arg ALLOW_UNSIGNED_BUILD=true (بیلد dev/سرور داخلی) داده شود.
ARG ALLOW_UNSIGNED_BUILD=false
RUN --mount=type=secret,id=license_signing_key \
    --mount=type=secret,id=license_signing_passphrase \
    if [ -s /run/secrets/license_signing_key ]; then \
      export LICENSE_SIGNING_PRIVATE_KEY_FILE=/run/secrets/license_signing_key MANIFEST_REQUIRED=true; \
      [ -s /run/secrets/license_signing_passphrase ] && export LICENSE_SIGNING_KEY_PASSPHRASE_FILE=/run/secrets/license_signing_passphrase; \
      npm run build:manifest; \
    elif [ "$ALLOW_UNSIGNED_BUILD" = "true" ]; then echo "[build] ALLOW_UNSIGNED_BUILD=true — integrity manifest skipped"; \
    else echo "[build] ERROR: no license_signing_key secret (set ALLOW_UNSIGNED_BUILD=true only for dev builds)"; exit 1; fi

# Production-only node_modules (+ tsx for the entrypoint seed) derived from the same install, without running scripts.
FROM deps AS prod-deps
RUN npm prune --omit=dev --no-audit --no-fund \
 && npm install --save-prod --omit=dev --ignore-scripts --no-audit --no-fund tsx@^4.23.12 \
 && npm cache clean --force

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
# کاربر غیرروت «قبل از» کپی فایل‌ها ساخته می‌شود و فایل‌ها با COPY --chown مالکیت می‌گیرند. قبلاً `chown -R /app` بعد از COPY
# کل node_modules (~۳GB) را در یک لایه‌ی تازه تکرار می‌کرد و دیسک ۲۴GB سرور را در حین build پر می‌کرد (۲۰ اکتبر ۲۰۲۶).
RUN addgroup -S exir && adduser -S exir -G exir \
 && mkdir -p /app/data/license \
 && chown -R exir:exir /app
COPY --chown=exir:exir --from=prod-deps /app/node_modules ./node_modules
COPY --chown=exir:exir --from=build /app/dist ./dist
COPY --chown=exir:exir --from=build /app/generated ./generated
COPY --chown=exir:exir --from=build /app/prisma ./prisma
COPY --chown=exir:exir --from=build /app/package.json ./package.json
COPY --chown=exir:exir --chmod=755 --from=build /app/docker-entrypoint.sh ./docker-entrypoint.sh
USER exir
EXPOSE 3001
ENTRYPOINT ["./docker-entrypoint.sh"]
