#!/usr/bin/env bash
# Regenerates scripts/sql/tenant-reown.sql from REOWN_STATEMENTS_QUERY (kept in sync by a unit test).
set -euo pipefail
cd "$(dirname "$0")/../../apps/backend-core"
npx tsx -e "
import { REOWN_STATEMENTS_QUERY } from './src/tenants/tenant-db-roles.ts';
const q = REOWN_STATEMENTS_QUERY.split('\$1::text').join(\":'owner'::text\");
process.stdout.write('-- GENERATED from apps/backend-core/src/tenants/tenant-db-roles.ts (REOWN_STATEMENTS_QUERY). Do not edit.\n-- usage: psql -X -d <tenant db> -v owner=<tenant role> -f scripts/sql/tenant-reown.sql   (as a superuser)\n-- Re-owns every non-extension object of the connected database to :owner, then the database itself.\n\\\\set ON_ERROR_STOP on\nBEGIN;\nSET LOCAL lock_timeout = \\'10s\\';\n' + q.trim() + '\n\\\\gexec\nCOMMIT;\nSELECT format(\\'ALTER DATABASE %I OWNER TO %I\\', current_database(), :\\'owner\\') \\\\gexec\n');
" > ../../scripts/sql/tenant-reown.sql
