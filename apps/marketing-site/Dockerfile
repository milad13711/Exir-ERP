# Multi-stage build for the public marketing/showcase site (industry
# templates, plan configurator) — a separate origin from the tenant app and
# admin console, meant to eventually move to its own subdomain (erp.eta.co.ir).
# Build context must be the repo root: `docker build -f apps/marketing-site/Dockerfile .`

FROM node:20-alpine AS deps
WORKDIR /app
ARG NPM_REGISTRY=https://registry.npmjs.org
RUN npm config set registry "$NPM_REGISTRY"
COPY apps/marketing-site/package.json apps/marketing-site/package-lock.json ./
RUN npm ci

FROM node:20-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY apps/marketing-site/ ./
ARG NEXT_PUBLIC_API_URL=http://localhost:3001/api
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
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
