#!/bin/sh
# Compiles the backend with tsc (real decorator metadata) and boots AppModule through @nestjs/testing with stubbed Prisma.
set -e
cd "$(dirname "$0")/.."
rm -rf .di-check
npx tsc -p tsconfig.build.json --outDir .di-check --incremental false --declaration false --sourceMap false
cp scripts/di-boot-check.mjs .di-check/di-boot-check.mjs
(cd .di-check && node di-boot-check.mjs)
rm -rf .di-check
