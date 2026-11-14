#!/usr/bin/env bash
# Installs the nightly off-site backup. Storage settings arrive as BACKUP_* environment
# variables from the Deploy workflow; with none set the timer still runs and reports
# "unconfigured" to diagnostics instead of silently doing nothing.
set -euo pipefail

backup_env=${1:?Pass staging or production}
deploy_path=${2:?Pass the deploy path}
case "$backup_env" in
  staging|production) ;;
  *) echo "Unsupported backup environment" >&2; exit 1 ;;
esac
case "$deploy_path" in
  /*) ;;
  *) echo "Deploy path must be absolute" >&2; exit 1 ;;
esac
if [[ "$deploy_path" =~ [^A-Za-z0-9/._-] ]]; then
  echo "Deploy path contains unsupported characters" >&2; exit 1
fi
for name in BACKUP_R2_ACCOUNT_ID BACKUP_BUCKET BACKUP_ACCESS_KEY_ID BACKUP_SECRET_ACCESS_KEY \
            BACKUP_AGE_RECIPIENT BACKUP_RETENTION_DAYS; do
  value=${!name:-}
  if [[ "$value" == *$'\n'* || "$value" == *$'\r'* ]]; then
    echo "$name contains a line break" >&2; exit 1
  fi
done

if [ -n "${BACKUP_AGE_RECIPIENT:-}" ] && ! command -v age >/dev/null 2>&1; then
  DEBIAN_FRONTEND=noninteractive apt-get install -y -q age >/dev/null \
    || { apt-get update -q >/dev/null && DEBIAN_FRONTEND=noninteractive apt-get install -y -q age >/dev/null; }
fi

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
install -d -m 755 /usr/local/lib/epic-stocks
install -d -m 700 /etc/epic-stocks
install -m 644 "$script_dir/backup_database.py" /usr/local/lib/epic-stocks/backup_database.py

config_file=$(mktemp)
unit_file=$(mktemp)
trap 'rm -f "$config_file" "$unit_file"' EXIT
chmod 600 "$config_file"
for name in BACKUP_R2_ACCOUNT_ID BACKUP_BUCKET BACKUP_ACCESS_KEY_ID BACKUP_SECRET_ACCESS_KEY \
            BACKUP_AGE_RECIPIENT BACKUP_RETENTION_DAYS; do
  printf '%s=%s\n' "$name" "${!name:-}" >> "$config_file"
done
install -m 600 "$config_file" /etc/epic-stocks/backup.env

sed -e "s|@APP_ENV@|$backup_env|g" -e "s|@DEPLOY_PATH@|$deploy_path|g" \
  "$script_dir/systemd/epic-stocks-backup.service" > "$unit_file"
install -m 644 "$unit_file" /etc/systemd/system/epic-stocks-backup.service
install -m 644 "$script_dir/systemd/epic-stocks-backup.timer" /etc/systemd/system/epic-stocks-backup.timer
systemctl daemon-reload
systemctl enable --now epic-stocks-backup.timer
# Until one backup has succeeded (first install, newly added credentials, a fix after a
# failure), take one now rather than waiting for the night, without delaying the deploy.
if ! grep -q '"last_result": "success"' /var/lib/epic-stocks-backup/status.json 2>/dev/null; then
  systemctl start --no-block epic-stocks-backup.service
fi
