#!/bin/sh
# Read Docker secrets into environment variables for the migration container.

for secret in /run/secrets/*; do
  if [ -r "$secret" ]; then
    name=$(basename "$secret" | tr '[:lower:]' '[:upper:]')
    export "$name"="$(cat "$secret")"
  fi
done

# Construct DATABASE_URL from component env vars (avoids hardcoded connection strings in compose)
# URL-encode the password so special chars like + are not misinterpreted by Prisma CLI
if [ -z "$DATABASE_URL" ] && [ -n "$DB_PASSWORD" ]; then
  ENCODED_PASSWORD=$(node -e "process.stdout.write(encodeURIComponent(process.env.DB_PASSWORD))")
  export DATABASE_URL="postgresql://${DB_USER:-siteguardian}:${ENCODED_PASSWORD}@${DB_HOST:-postgres}:${DB_PORT:-5432}/${DB_NAME:-siteguardian}"
fi

exec "$@"
