#!/usr/bin/env bash
# بسته‌ی افزونه‌ی وردپرس فرم‌ساز را از scripts/wordpress/exir-forms می‌سازد و برای دانلود در پنل می‌گذارد.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/apps/web-panel/public/downloads/exir-forms-wordpress.zip"
mkdir -p "$(dirname "$OUT")"
rm -f "$OUT"
(cd "$ROOT/scripts/wordpress" && zip -r -X "$OUT" exir-forms -x '*.DS_Store')
echo "Built $OUT"
