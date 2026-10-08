#!/usr/bin/env bash
# Prints (does NOT write) set_real_ip_from lines for ArvanCloud + Cloudflare. Review, then paste into real-ip.conf.
set -euo pipefail
fetch() { curl -fsS --max-time 15 "$1" || { echo "# FAILED to fetch $1" >&2; return 0; }; }
echo "# --- ArvanCloud ($(date -u +%F)) ---"
fetch https://www.arvancloud.ir/en/ips.txt | grep -E '^[0-9a-fA-F:.]+(/[0-9]+)?$' | sed 's/^/set_real_ip_from /; s/$/;/'
echo "# --- Cloudflare ---"
{ fetch https://www.cloudflare.com/ips-v4; echo; fetch https://www.cloudflare.com/ips-v6; } | grep -E '^[0-9a-fA-F:.]+/[0-9]+$' | sed 's/^/set_real_ip_from /; s/$/;/'
