#!/bin/sh
# Runs on every container start (cloud or on-premise): brings the Control
# Plane database schema up to date, seeds its static catalog data (plans,
# module marketplace, the super-admin account), then — only in on-premise
# deployments — provisions the local single tenant from the license
# (see src/scripts/bootstrap-on-premise.ts; a no-op once already done).
# All three steps are idempotent, so they're safe to re-run on every boot,
# including a plain container restart.
set -e

echo "[entrypoint] applying Control Plane migrations..."
npx prisma migrate deploy --schema prisma/control/schema.prisma

echo "[entrypoint] seeding Control Plane catalog data..."
npx tsx prisma/control/seed.ts

if [ "$DEPLOYMENT_MODE" = "ON_PREMISE" ]; then
  echo "[entrypoint] on-premise deployment detected — bootstrapping local tenant..."
  node dist/scripts/bootstrap-on-premise.js
fi

echo "[entrypoint] starting server..."
exec node dist/main.js
