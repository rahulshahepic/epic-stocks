#!/usr/bin/env bash
set -euo pipefail

diagnostics_env=${1:?Pass staging or production}
case "$diagnostics_env" in
  staging|production) ;;
  *) echo "Unsupported diagnostics environment" >&2; exit 1 ;;
esac

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
# ProtectHome hides the checkout if DEPLOY_PATH is in /root or /home.
# Install only the collector into a fixed, root-owned path outside those trees.
install -d -m 755 /usr/local/lib/epic-stocks /var/lib/epic-stocks-diagnostics
install -m 644 "$script_dir/collect_diagnostics.py" /usr/local/lib/epic-stocks/collect_diagnostics.py
unit_file=$(mktemp)
trap 'rm -f "$unit_file"' EXIT
sed "s|@APP_ENV@|$diagnostics_env|g" "$script_dir/systemd/epic-stocks-diagnostics.service" > "$unit_file"
install -m 644 "$unit_file" /etc/systemd/system/epic-stocks-diagnostics.service
install -m 644 "$script_dir/systemd/epic-stocks-diagnostics.timer" /etc/systemd/system/epic-stocks-diagnostics.timer
systemctl daemon-reload
systemctl enable --now epic-stocks-diagnostics.timer
# The first collection is optional and must not delay application deployment.
systemctl start --no-block epic-stocks-diagnostics.service
