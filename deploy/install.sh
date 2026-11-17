#!/usr/bin/env sh
# NorthKit: first install on the customer's server. Copied from NorthCore WMS.
#
#   sh deploy/install.sh                  write deploy/.env with fresh secrets
#   sh deploy/install.sh --new-setup-code replace the one-time set-up code only
#
# Makes deploy/.env from deploy/.env.example, filling every blank secret with a fresh
# random value, and a one-time set-up code (NORTHKIT_SETUP_CODE) that the first-run
# screen asks for. The code is printed ONCE here; it stays in deploy/.env (readable by
# this server's admins only) and stops working once the first administrator exists.
# There is no default password anywhere. Nothing is sent anywhere: everything is made
# on this machine.
set -eu

cd "$(dirname "$0")"
ENV_FILE=.env

# A random value of $1 characters from $2 (default: letters and digits).
random() {
  LC_ALL=C tr -dc "${2:-A-Za-z0-9}" </dev/urandom | head -c "$1"
}

# Readable over the phone: no 0/O, 1/I/L. 3 groups of 4 (about 59 bits), and the
# set-up screen allows 5 wrong tries per 15 minutes.
setup_code() {
  code=$(random 12 'ABCDEFGHJKMNPQRSTUVWXYZ23456789')
  printf '%s-%s-%s' "$(echo "$code" | cut -c1-4)" "$(echo "$code" | cut -c5-8)" "$(echo "$code" | cut -c9-12)"
}

show_code() {
  echo
  echo "  ------------------------------------------------------------"
  echo "  First-run set-up code:  $1"
  echo "  ------------------------------------------------------------"
  echo "  Open NorthKit in a browser and enter this code to create the"
  echo "  first administrator. It is shown only now (it is also kept in"
  echo "  deploy/.env) and stops working once set-up is done."
  echo
}

set_value() { # set_value NAME VALUE: replace NAME= line, or append it
  if grep -q "^$1=" "$ENV_FILE"; then
    tmp=$(mktemp)
    sed "s|^$1=.*|$1=$2|" "$ENV_FILE" >"$tmp" && cat "$tmp" >"$ENV_FILE" && rm -f "$tmp"
  else
    printf '%s=%s\n' "$1" "$2" >>"$ENV_FILE"
  fi
}

if [ "${1:-}" = "--new-setup-code" ]; then
  [ -f "$ENV_FILE" ] || { echo "deploy/.env doesn't exist yet: run sh deploy/install.sh first." >&2; exit 1; }
  code=$(setup_code)
  set_value NORTHKIT_SETUP_CODE "$code"
  echo "New set-up code saved in deploy/.env. Restart the web service to use it:"
  echo "  docker compose -f deploy/docker-compose.yml up -d web"
  show_code "$code"
  exit 0
fi

if [ -f "$ENV_FILE" ]; then
  echo "deploy/.env already exists, so nothing was changed."
  if ! grep -q '^NORTHKIT_SETUP_CODE=.' "$ENV_FILE"; then
    echo "It has no set-up code. Make one with: sh deploy/install.sh --new-setup-code"
  fi
  exit 0
fi

umask 077 # deploy/.env is readable by this user only
cp .env.example "$ENV_FILE"
set_value POSTGRES_PASSWORD "$(random 40)"
set_value NORTHKIT_APP_DB_PASSWORD "$(random 40)"
set_value NORTHKIT_READONLY_DB_PASSWORD "$(random 40)"
# 32 random bytes, base64 (AES-256 key for two-factor secrets).
set_value NORTHKIT_SECRET_KEY "$(head -c 32 /dev/urandom | base64 | tr -d '\n')"
# The development-only seed account stays blank on a live install.
set_value SEED_ADMIN_PASSWORD ""
code=$(setup_code)
set_value NORTHKIT_SETUP_CODE "$code"

echo "Wrote deploy/.env with fresh passwords and keys (readable by $(id -un) only)."
echo "Start NorthKit with:"
echo "  docker compose -f deploy/docker-compose.yml up -d"
show_code "$code"
