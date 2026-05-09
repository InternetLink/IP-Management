#!/bin/sh
set -eu

if [ -z "${DATABASE_URL:-}" ]; then
  if [ -n "${MYSQL_CONNECTION_STRING:-}" ]; then
    export DATABASE_URL="$MYSQL_CONNECTION_STRING"
  elif [ -n "${MYSQL_URI:-}" ]; then
    export DATABASE_URL="$MYSQL_URI"
  elif [ -n "${MYSQL_URL:-}" ]; then
    export DATABASE_URL="$MYSQL_URL"
  elif [ -n "${MYSQL_HOST:-}" ] && [ -n "${MYSQL_USERNAME:-}" ] && [ -n "${MYSQL_PASSWORD:-}" ] && [ -n "${MYSQL_DATABASE:-}" ]; then
    export DATABASE_URL="mysql://${MYSQL_USERNAME}:${MYSQL_PASSWORD}@${MYSQL_HOST}:${MYSQL_PORT:-3306}/${MYSQL_DATABASE}"
  elif [ -n "${MYSQLHOST:-}" ] && [ -n "${MYSQLUSER:-}" ] && [ -n "${MYSQLPASSWORD:-}" ] && [ -n "${MYSQLDATABASE:-}" ]; then
    export DATABASE_URL="mysql://${MYSQLUSER}:${MYSQLPASSWORD}@${MYSQLHOST}:${MYSQLPORT:-3306}/${MYSQLDATABASE}"
  else
    echo "DATABASE_URL is missing."
    echo "Set DATABASE_URL manually, or provide MYSQL_CONNECTION_STRING / MYSQL_URI / MYSQL_URL, or MySQL component variables."
    exit 1
  fi
fi

for attempt in $(seq 1 30); do
  if npm run db:push; then
    exec node dist/main
  fi

  echo "Waiting for database... (${attempt}/30)"
  sleep 2
done

echo "Database schema sync failed after 30 attempts."
exit 1
