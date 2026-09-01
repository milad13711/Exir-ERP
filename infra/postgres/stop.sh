#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
export PATH="/usr/local/opt/postgresql@16/bin:$PATH"
OBJC_DISABLE_INITIALIZE_FORK_SAFETY=YES LC_ALL=C pg_ctl -D data stop
