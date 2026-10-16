#!/usr/bin/env bash
# Google Drive 한글 경로에서는 sqlite3 네이티브 모듈 빌드가 실패할 수 있어 /tmp에서 실행합니다.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
API_SRC="$ROOT/KOREA_WEBTOON_API"
RUN_DIR="/tmp/KOREA_WEBTOON_API_RUN"
OUTPUT="$ROOT/webtoons-sample.json"

rm -rf "$RUN_DIR"
cp -R "$API_SRC" "$RUN_DIR"
cd "$RUN_DIR"
npm ci --no-fund
EXPORT_OUTPUT_PATH="$OUTPUT" npm run export:sample

echo "Sample written to: $OUTPUT"
