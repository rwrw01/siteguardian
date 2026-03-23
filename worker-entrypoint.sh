#!/bin/sh
# Read Docker secrets into environment variables for the worker container.

for secret in /run/secrets/*; do
  if [ -r "$secret" ]; then
    name=$(basename "$secret" | tr '[:lower:]' '[:upper:]')
    export "$name"="$(cat "$secret")"
  fi
done

# Construct connection URLs from component env vars (avoids hardcoded connection strings in compose)
if [ -z "$DATABASE_URL" ] && [ -n "$DB_PASSWORD" ]; then
  export DATABASE_URL="postgresql://${DB_USER:-siteguardian}:${DB_PASSWORD}@${DB_HOST:-postgres}:${DB_PORT:-5432}/${DB_NAME:-siteguardian}"
fi

if [ -z "$REDIS_URL" ]; then
  export REDIS_URL="redis://${REDIS_HOST:-redis}:${REDIS_PORT:-6379}"
fi

exec "$@"
