# Multi-stage build for the internal Exir team admin console (تننت‌ها،
# اشتراک‌ها، پشتیبانی — نه چیزی که برای تننت‌ها منتشر می‌شود).
# Build context must be the repo root: `docker build -f apps/admin-panel/Dockerfile .`

FROM node:20-alpine AS deps
WORKDIR /app
# Some networks (notably inside Iran) block registry.npmjs.org outright —
# override with e.g. --build-arg NPM_REGISTRY=https://mirror-npm.runflare.com
ARG NPM_REGISTRY=https://registry.npmjs.org
RUN npm config set registry "$NPM_REGISTRY"
COPY apps/admin-panel/package.json apps/admin-panel/package-lock.json ./
RUN npm ci

FROM node:20-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY apps/admin-panel/ ./
# Baked in at build time — unlike the tenant web panel, this console isn't
# served same-origin behind the on-premise nginx (it's an internal tool,
# not part of the tenant bundle), so it needs the real, reachable API URL.
ARG NEXT_PUBLIC_API_URL=http://localhost:3001/api
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
# Used only to build a "copy payment link" URL that points at the tenant
# web panel's public /pay/:invoiceId page (see PublicInvoicePaymentController).
ARG NEXT_PUBLIC_WEB_PANEL_URL=http://localhost:3000
ENV NEXT_PUBLIC_WEB_PANEL_URL=$NEXT_PUBLIC_WEB_PANEL_URL
RUN npm run build

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
RUN addgroup -S exir && adduser -S exir -G exir
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
USER exir
EXPOSE 3000
CMD ["node", "server.js"]
