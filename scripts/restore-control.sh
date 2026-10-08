#!/usr/bin/env bash
# Restore the CONTROL-PLANE database (exir_control: tenants, users, memberships, invoices, API keys, licenses...).
# Dry-run unless --yes. Stop the backend first. See docs/disaster-recovery.md.
#   BACKUP_ENCRYPTION_KEY=... ./scripts/restore-control.sh --docker --file backups/_control/2026-10-08.sql.gz.enc
exec "$(cd "$(dirname "$0")" && pwd)/restore-db.sh" --mode control --db exir_control "$@"
