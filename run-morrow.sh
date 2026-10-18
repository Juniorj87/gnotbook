#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then echo "Node.js 20+ is required (https://nodejs.org)." >&2; exit 1; fi
if [ ! -f .env ]; then cp .env.example .env; fi
if [ ! -d node_modules ]; then npm install --no-audit --no-fund; fi
npm test
npm start
