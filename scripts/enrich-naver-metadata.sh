#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
API_SRC="$ROOT/KOREA_WEBTOON_API"
RUN_DIR="/tmp/KOREA_WEBTOON_API_RUN"

rm -rf "$RUN_DIR"
cp -R "$API_SRC" "$RUN_DIR"
cd "$RUN_DIR"
npm ci --no-fund

export ENRICH_LIMIT="${ENRICH_LIMIT:-30}"
export ENRICH_DELAY_MS="${ENRICH_DELAY_MS:-200}"
npm run enrich:naver
