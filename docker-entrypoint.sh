#!/bin/sh
# Read Docker secrets into environment variables.
# Secrets are mounted as root:root 0600 — this entrypoint runs as root,
# reads them, exports as env vars, then drops privileges to nextjs user.

for secret in /run/secrets/*; do
  if [ -f "$secret" ]; then
    name=$(basename "$secret" | tr '[:lower:]' '[:upper:]')
    export "$name"="$(cat "$secret")"
  fi
done

exec gosu nextjs node server.js
