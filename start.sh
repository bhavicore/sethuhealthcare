#!/usr/bin/env bash
# Start Sethu with one command: the server (http://localhost:4000) and the
# app (http://localhost:5173). Press Ctrl+C once to stop both.
set -e
cd "$(dirname "$0")"

for dir in server client; do
  if [ ! -d "$dir/node_modules" ]; then
    echo "Installing $dir dependencies (first run only)…"
    (cd "$dir" && npm install --no-audit --no-fund)
  fi
done

# Loads server/.env (API keys) if present; runs fine without it.
(cd server && node --env-file-if-exists=.env src/index.js) &
SERVER_PID=$!
trap 'kill $SERVER_PID 2>/dev/null' EXIT INT TERM

cd client && npm run dev -- --port 5173 --strictPort
