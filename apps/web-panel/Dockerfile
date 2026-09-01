# Multi-stage build for the Exir ERP web panel (Next.js), used both for the
# shared cloud deployment and for on-premise bundles — see docs/ON_PREMISE.md.
# Build context must be the repo root: `docker build -f apps/web-panel/Dockerfile .`

FROM node:20-alpine AS deps
WORKDIR /app
# Some networks (notably inside Iran) block registry.npmjs.org outright —
# override with e.g. --build-arg NPM_REGISTRY=https://mirror-npm.runflare.com
ARG NPM_REGISTRY=https://registry.npmjs.org
RUN npm config set registry "$NPM_REGISTRY"
COPY apps/web-panel/package.json apps/web-panel/package-lock.json ./
RUN npm ci

FROM node:20-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY apps/web-panel/ ./
# NEXT_PUBLIC_* values are baked in at build time. The on-premise bundle
# always talks to the API same-origin through the bundled nginx reverse
# proxy (see infra/on-premise/nginx.conf), so this never needs to be a real
# external URL.
ENV NEXT_PUBLIC_API_URL=/api
# Must match the ON_PREM_ORG_SLUG the backend's bootstrap script actually
# provisioned (see src/scripts/bootstrap-on-premise.ts) — a mismatch here
# fails login with "این محیط کاری یافت نشد یا فعال نیست" even with a
# correct OTP, since the frontend sends the wrong tenant slug.
ARG NEXT_PUBLIC_TENANT_SLUG=exir-demo
ENV NEXT_PUBLIC_TENANT_SLUG=$NEXT_PUBLIC_TENANT_SLUG
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
