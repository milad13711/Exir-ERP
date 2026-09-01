#!/usr/bin/env bash
# Starts the project-local dev PostgreSQL cluster (port 5433).
# This is a self-contained dev DB in infra/postgres/data — it does not touch
# any system-wide postgres install or brew services.
set -euo pipefail
cd "$(dirname "$0")"
export PATH="/usr/local/opt/postgresql@16/bin:$PATH"
OBJC_DISABLE_INITIALIZE_FORK_SAFETY=YES LC_ALL=C pg_ctl -D data -l logfile -o "-p 5433 -k /tmp" start
