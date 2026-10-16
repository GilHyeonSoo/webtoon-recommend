#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/Frontend"

if ! npx vercel whoami &>/dev/null; then
  echo "먼저 로그인: npx vercel login"
  exit 1
fi

npx vercel --prod "$@"
