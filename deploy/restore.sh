#!/usr/bin/env sh
# NorthKit: restore the database from a backup made by deploy/backup.sh (DB-12).
#
#   sh deploy/restore.sh deploy/backups/northkit-20261114-023000.dump
#   sh deploy/restore.sh <file> --yes      skip the confirmation (scripts, tests)
#
# REPLACES the current database with the backup. Works on the same server or a new one
# (a clean install made with deploy/install.sh): the web app and worker are stopped, the
# database is recreated, the dump is loaded, then the migrate step runs, which sets the
# role passwords from this server's deploy/.env and applies any newer migrations (so a
# backup from an older version upgrades on the way in).
set -eu
# Git Bash on Windows rewrites /paths in arguments; container paths must stay as they are.
export MSYS_NO_PATHCONV=1

cd "$(dirname "$0")"
[ -f .env ] || { echo "deploy/.env not found: run sh deploy/install.sh first." >&2; exit 1; }
[ $# -ge 1 ] || { echo "Usage: sh deploy/restore.sh <backup.dump> [--yes]" >&2; exit 1; }
case "$1" in /*) dump="$1" ;; deploy/*) dump="../$1" ;; *) dump="$1" ;; esac
[ -f "$dump" ] || { echo "Backup file not found: $1" >&2; exit 1; }

env_value() { grep -E "^$1=" .env | tail -n 1 | cut -d= -f2-; }
PGUSER=$(env_value POSTGRES_USER); PGUSER=${PGUSER:-postgres}
DB=$(env_value NORTHKIT_DB_NAME); DB=${DB:-northkit}
case "$DB" in *[!a-z0-9_]*) echo "NORTHKIT_DB_NAME must be lower-case letters, digits and _." >&2; exit 1 ;; esac
compose="docker compose -f docker-compose.yml"

if [ "${2:-}" != "--yes" ]; then
  printf 'This replaces the database "%s" with %s. Type RESTORE to carry on: ' "$DB" "$1"
  read -r answer
  [ "$answer" = "RESTORE" ] || { echo "Nothing changed."; exit 1; }
fi

$compose up -d --wait db
$compose stop web worker >/dev/null 2>&1 || true

# The dump is checked before anything is dropped.
$compose exec -T db pg_restore --list >/dev/null <"$dump"

psql() { $compose exec -T db psql -v ON_ERROR_STOP=1 -U "$PGUSER" "$@"; }
psql -d postgres -c "DROP DATABASE IF EXISTS $DB WITH (FORCE)" -c "CREATE DATABASE $DB"
# Roles live outside any one database, so a new server needs them before the objects
# that belong to them. Migration 0001 asserts their safety settings again afterwards.
psql -d "$DB" <<'SQL'
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'northkit_owner') THEN CREATE ROLE northkit_owner NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'northkit_app') THEN CREATE ROLE northkit_app NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'northkit_readonly') THEN CREATE ROLE northkit_readonly NOLOGIN; END IF;
END
$$;
SQL
$compose exec -T db pg_restore -U "$PGUSER" -d "$DB" --exit-on-error <"$dump"
# Database-level grants aren't part of a single-database dump.
psql -d "$DB" -c "GRANT CONNECT, CREATE ON DATABASE $DB TO northkit_owner" \
  -c "GRANT CONNECT ON DATABASE $DB TO northkit_app, northkit_readonly" \
  -c "REVOKE ALL ON DATABASE $DB FROM PUBLIC"

# The files archive (photos and service reports) made with the dump, if there is one, replaces the files volume.
photos="${dump%.dump}.files.tar.gz"
if [ -f "$photos" ]; then
  $compose run --rm --no-deps -T --entrypoint sh web -c 'find /data/files -mindepth 1 -delete && tar -C /data -xzf -' <"$photos"
  echo "Photos restored from $photos"
else
  echo "No photos archive beside the dump; the files volume was left as it is."
fi

# Role passwords from this server's .env, and any migrations newer than the backup.
$compose run --rm migrate
$compose up -d web worker
echo "Restored $1 into $DB. NorthKit is starting again."
