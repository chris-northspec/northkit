#!/usr/bin/env sh
# NorthKit: back up the database (DB-12).
#
#   sh deploy/backup.sh
#
# Writes a compressed PostgreSQL dump (pg_dump custom format) of the whole database, and
# an archive of the photos and service reports on the files volume, to
# NORTHKIT_BACKUP_DIR (default deploy/backups) and deletes dumps older than
# NORTHKIT_BACKUP_KEEP_DAYS (default 14). Run it nightly from cron, for example:
#   30 2 * * * cd /opt/northkit && sh deploy/backup.sh >> deploy/backups/backup.log 2>&1
# Copy the dumps somewhere else as well (another disk, another site): a backup on the
# same server doesn't survive losing the server. Nothing is sent anywhere by this script.
set -eu
# Git Bash on Windows rewrites /paths in arguments; container paths must stay as they are.
export MSYS_NO_PATHCONV=1

cd "$(dirname "$0")"
[ -f .env ] || { echo "deploy/.env not found: run sh deploy/install.sh first." >&2; exit 1; }

# One value from deploy/.env, without running the file as a script.
env_value() { grep -E "^$1=" .env | tail -n 1 | cut -d= -f2-; }

PGUSER=$(env_value POSTGRES_USER); PGUSER=${PGUSER:-postgres}
DB=$(env_value NORTHKIT_DB_NAME); DB=${DB:-northkit}
DIR=$(env_value NORTHKIT_BACKUP_DIR); DIR=${DIR:-./backups}
KEEP=$(env_value NORTHKIT_BACKUP_KEEP_DAYS); KEEP=${KEEP:-14}

mkdir -p "$DIR"
umask 077 # dumps hold personal data: readable by this user only
stamp=$(date -u +%Y%m%d-%H%M%S)
file="$DIR/northkit-$stamp.dump"
tmp="$file.partial"

docker compose -f docker-compose.yml exec -T db pg_dump -U "$PGUSER" -d "$DB" --format=custom --compress=6 >"$tmp"
# A dump that pg_restore can't list is not a backup.
docker compose -f docker-compose.yml exec -T db pg_restore --list >/dev/null <"$tmp"
mv "$tmp" "$file"
echo "Backup written: $file ($(wc -c <"$file" | tr -d ' ') bytes)"

# Photos and service reports live on the files volume, not in the database: archive them alongside.
photos="$DIR/northkit-$stamp.files.tar.gz"
docker compose -f docker-compose.yml run --rm --no-deps -T --entrypoint tar web -C /data -czf - files >"$photos.partial"
mv "$photos.partial" "$photos"
echo "Photos and service reports written: $photos"

find "$DIR" \( -name 'northkit-*.dump' -o -name 'northkit-*.files.tar.gz' \) -type f -mtime "+$KEEP" -print -delete | sed 's/^/Deleted old backup: /'
