#!/bin/sh
# Read Docker secrets into environment variables.
# This script runs as the nextjs user (UID 1001).
# Secrets must be readable by this user (chmod 444 on host or via compose).

for secret in /run/secrets/*; do
  if [ -r "$secret" ]; then
    name=$(basename "$secret" | tr '[:lower:]' '[:upper:]')
    export "$name"="$(cat "$secret")"
  fi
done

exec node server.js
