#!/usr/bin/env bash
#
# Runs the integration suite against the real MySQL 8 and Redis from
# docker-compose, with the schema created by the real migration.
#
# It creates a throwaway database, applies the migration to it, runs the tests
# and drops the database again. Nothing touches the application database, and
# any extra arguments are forwarded to jest.
#
#   npm run test:e2e:mysql
#   npm run test:e2e:mysql -- --testPathPattern user-mapping
#   KEEP=1 npm run test:e2e:mysql     # keep the database for inspection
#
set -euo pipefail

cd "$(dirname "$0")/.."

TEST_DATABASE="${TEST_DATABASE:-user_mapping_test}"
KEEP="${KEEP:-0}"

# Runs a command inside the mysql container, where the credentials are already
# present as environment variables (so this script never has to read .env).
mysql_exec() {
  docker compose exec -T mysql sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD"' "$@"
}
container_env() {
  docker compose exec -T "$1" sh -c "printf %s \"\$$2\""
}
wait_for_healthy() {
  for _ in $(seq 1 60); do
    docker compose ps --format '{{.Service}}={{.Status}}' | grep -q "^$1=.*healthy" && return 0
    sleep 2
  done
  echo "!! $1 did not become healthy in time" >&2
  return 1
}
# Ask compose for the published host port instead of assuming a mapping, so a
# port override in .env (for example REDIS_PORT) is honoured automatically.
published_port() {
  docker compose port "$1" "$2" | head -n 1 | sed 's/.*://'
}

cleanup() {
  if [ "$KEEP" = "1" ]; then
    echo "==> keeping database $TEST_DATABASE (KEEP=1)"
    return
  fi
  echo "==> dropping database $TEST_DATABASE"
  echo "DROP DATABASE IF EXISTS $TEST_DATABASE;" | mysql_exec || true
}
trap cleanup EXIT

echo "==> starting MySQL and Redis"
docker compose up -d mysql redis >/dev/null
wait_for_healthy mysql
wait_for_healthy redis

HOST_DB_PORT="$(published_port mysql 3306)"
HOST_REDIS_PORT="$(published_port redis 6379)"

DB_USERNAME="$(container_env mysql MYSQL_USER)"
DB_PASSWORD="$(container_env mysql MYSQL_PASSWORD)"
REDIS_PASSWORD="$(container_env redis REDIS_PASSWORD)"

echo "==> creating database $TEST_DATABASE"
echo "CREATE DATABASE IF NOT EXISTS $TEST_DATABASE;
GRANT ALL PRIVILEGES ON $TEST_DATABASE.* TO '$DB_USERNAME'@'%';
FLUSH PRIVILEGES;" | mysql_exec

export DB_TYPE=mysql
export DB_HOST=127.0.0.1
export DB_PORT="$HOST_DB_PORT"
export DB_USERNAME
export DB_PASSWORD
export DB_DATABASE="$TEST_DATABASE"
export DB_SYNCHRONIZE=false
export REDIS_URL="redis://127.0.0.1:$HOST_REDIS_PORT"
export REDIS_PASSWORD

echo "==> applying the migration to $TEST_DATABASE"
npm run --silent migration:run

echo "==> running the integration suite against MySQL 8 + Redis"
npx jest --config ./test/jest-e2e.json "$@"
