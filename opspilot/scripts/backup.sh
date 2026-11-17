#!/usr/bin/env bash
set -euo pipefail
: "${DATABASE_URL:?Set DATABASE_URL before running a backup}"
umask 077
output="${1:-opspilot-$(date -u +%Y%m%dT%H%M%SZ).dump}"
if [ -e "$output" ]; then echo "Refusing to overwrite an existing backup." >&2; exit 1; fi
pg_dump --format=custom --no-owner --no-acl "$DATABASE_URL" > "$output"
echo "Backup written to $output. Store it encrypted, off-host, and test restoration regularly."
