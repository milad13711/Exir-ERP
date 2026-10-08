#!/usr/bin/env bash
# Restore ONE tenant database from a backup file. Dry-run unless --yes. See docs/disaster-recovery.md.
#   BACKUP_ENCRYPTION_KEY=... ./scripts/restore-tenant.sh --docker --file backups/acme/2026-10-08.sql.gz.enc --db exir_tenant_acme
#   (add --yes to apply; add --force to overwrite a database that already has tables)
exec "$(cd "$(dirname "$0")" && pwd)/restore-db.sh" --mode tenant "$@"
