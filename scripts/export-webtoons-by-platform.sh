#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
API_SRC="$ROOT/KOREA_WEBTOON_API"
RUN_DIR="/tmp/KOREA_WEBTOON_API_RUN"
OUTPUT_DIR="$ROOT/data/webtoons"

rm -rf "$RUN_DIR"
cp -R "$API_SRC" "$RUN_DIR"
cd "$RUN_DIR"
npm ci --no-fund

export COUNT_PER_PLATFORM="${COUNT_PER_PLATFORM:-10}"
export EXPORT_OUTPUT_DIR="$OUTPUT_DIR"
npm run export:platform

echo "Platform JSON files written under: $OUTPUT_DIR"
