#!/usr/bin/env bash
set -Eeuo pipefail
umask 022

die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
log() { printf '\n[AppSpace] %s\n' "$*"; }
[[ ${EUID} -eq 0 ]] || die 'Run with sudo: sudo bash deploy/install-ubuntu.sh apps.yourdomain.com'
[[ $# -ge 1 && $# -le 2 ]] || die 'Usage: sudo bash deploy/install-ubuntu.sh apps.yourdomain.com [upload.yourdomain.com | --no-direct-upload]'
domain=${1,,}
[[ ${#domain} -le 253 && "$domain" =~ ^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$ ]] || die 'Enter a domain name only, for example apps.yourdomain.com (no https:// or path).'
[[ $(uname -m) == x86_64 ]] || die 'This package requires an x86_64 VPS.'
# shellcheck disable=SC1091
source /etc/os-release
[[ ${ID:-} == ubuntu && ( ${VERSION_ID:-} == 24.04 || ${VERSION_ID:-} == 22.04 ) ]] || die 'Use Ubuntu Server 24.04 LTS x64 (22.04 is also supported).'
[[ -d /run/systemd/system ]] || die 'This installer requires a VPS running systemd.'
source_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)
[[ -f "$source_dir/server/index.mjs" && -f "$source_dir/package-lock.json" && -f "$source_dir/package-info.json" ]] || die 'Extract the complete VPS package first.'
install_root=/opt/appspace
data_root=/var/lib/appspace
config_dir=/etc/appspace
config_file=$config_dir/appspace.env
upload_domain=${2:-}
if [[ $# -eq 1 && -f "$config_file" ]]; then
  upload_domain=$(sed -n 's|^UPLOAD_BASE_URL=https://||p' "$config_file")
fi
[[ "$upload_domain" != --no-direct-upload ]] || upload_domain=''
if [[ -n "$upload_domain" ]]; then
  upload_domain=${upload_domain,,}
  [[ ${#upload_domain} -le 253 && "$upload_domain" =~ ^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$ && "$upload_domain" != "$domain" ]] || die 'Use a separate upload domain, for example upload.yourdomain.com.'
fi
node_version=v24.22.1
node_archive=node-${node_version}-linux-x64.tar.xz
node_sha=6c172a9ab6718f7b801fb5a7bd486af2ee5e32758086a04b84fcce2aa77095e6
node_dir=$install_root/node-${node_version}-linux-x64
for safe_dir in "$install_root" "$data_root" "$config_dir"; do [[ ! -L "$safe_dir" ]] || die "Refusing symbolic directory: $safe_dir"; done
if [[ -e "$install_root/current" && ! -L "$install_root/current" ]]; then die '/opt/appspace/current must be a managed release symlink.'; fi
[[ ! -L "$config_file" ]] || die 'The environment file may not be a symbolic link.'
if [[ -f "$config_file" ]] && ! grep -Fxq "PUBLIC_BASE_URL=https://$domain" "$config_file"; then
  die 'Existing installation uses a different domain. Keep the original domain to preserve previously shared app links.'
fi
if [[ -e "$install_root/current" ]]; then
  [[ -x "$install_root/node/bin/node" && -f "$config_file" ]] || die 'Existing installation is incomplete; inspect it before updating.'
  # Do not interrupt a signing operation during a normal update.
  if systemctl is-active --quiet appspace; then
    "$install_root/node/bin/node" --env-file="$config_file" "$source_dir/deploy/check-idle.mjs" || die 'Server is busy or its status could not be checked. Try the update after signing completes.'
  fi
fi

log 'Installing Ubuntu packages...'
apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install -y ca-certificates curl xz-utils tar rsync openssl caddy
id -u appspace >/dev/null 2>&1 || useradd --system --user-group --home-dir "$data_root" --shell /usr/sbin/nologin appspace
install -d -m 0755 "$install_root" "$install_root/releases"
install -d -m 0700 "$config_dir"
install -d -o appspace -g appspace -m 0700 "$data_root"

if [[ ! -x "$node_dir/bin/node" ]]; then
  log "Installing official Node.js $node_version (SHA-256 verified)..."
  node_download=$(mktemp -d)
  trap 'if [[ -n ${node_download:-} && -d $node_download ]]; then rm -f -- "$node_download/$node_archive"; rmdir -- "$node_download" 2>/dev/null || true; fi' EXIT
  curl --fail --location --retry 3 --max-time 300 "https://nodejs.org/dist/$node_version/$node_archive" -o "$node_download/$node_archive"
  printf '%s  %s\n' "$node_sha" "$node_download/$node_archive" | sha256sum --check --status || die 'Node.js checksum mismatch.'
  tar -xJf "$node_download/$node_archive" -C "$install_root" --no-same-owner
fi
[[ $("$node_dir/bin/node" --version) == "$node_version" ]] || die 'Unexpected Node.js version.'
ln -sfn "$node_dir" "$install_root/node"

log 'Preparing a new application release...'
release_dir=$(mktemp -d "$install_root/releases/release-XXXXXXXX")
rsync -a --exclude='data/' --exclude='.env' --exclude='.git/' --exclude='node_modules/' --exclude='tools/' --exclude='packages/' --exclude='_site/' --exclude='.preview/' --exclude='*.p12' --exclude='*.mobileprovision' "$source_dir/" "$release_dir/"
chown -R appspace:appspace "$release_dir"
chmod 0755 "$release_dir"
(
  cd "$release_dir"
  runuser -u appspace -- env PATH="$node_dir/bin:/usr/bin:/bin" npm ci --omit=dev --no-audit --no-fund
  runuser -u appspace -- env PATH="$node_dir/bin:/usr/bin:/bin" "$node_dir/bin/node" scripts/setup-signer.mjs
)

if [[ ! -f "$config_file" ]]; then
  log 'Creating a new admin password for this VPS...'
  admin_secret=$(openssl rand -hex 24)
  (umask 077; printf 'NODE_ENV=production\nHOST=127.0.0.1\nPORT=4173\nPUBLIC_BASE_URL=https://%s\nDATA_DIR=%s\nZSIGN_BIN=/opt/appspace/current/tools/zsign/zsign\nADMIN_TOKEN=%s\n' "$domain" "$data_root" "$admin_secret" > "$config_file")
  (umask 077; printf '%s\n' "$admin_secret" > "$config_dir/admin-password.txt")
  unset admin_secret
fi
if [[ ! -f "$config_dir/admin-password.txt" ]]; then
  (umask 077; sed -n 's/^ADMIN_TOKEN=//p' "$config_file" > "$config_dir/admin-password.txt")
fi
chmod 0600 "$config_file"
[[ ! -f "$config_dir/admin-password.txt" ]] || chmod 0600 "$config_dir/admin-password.txt"

log 'Importing only publicly exported apps; existing app IDs are preserved...'
(
  cd "$release_dir"
  runuser -u appspace -- env PATH="$node_dir/bin:/usr/bin:/bin" "$node_dir/bin/node" deploy/import-public-apps.mjs "$release_dir/public-apps" "$data_root" "https://$domain"
)
# Runtime can write only its data directory. Source, dependencies and signer stay read-only.
chown -R root:root "$release_dir"
chmod -R go-w "$release_dir"

log 'Configuring HTTPS with Caddy...'
install -d -m 0755 /etc/caddy/appspace.d
caddy_config=/etc/caddy/Caddyfile
caddy_site=/etc/caddy/appspace.d/appspace.caddy
caddy_backup=$(mktemp -d "$config_dir/caddy-backup-XXXXXXXX")
[[ ! -f "$caddy_config" ]] || cp -a "$caddy_config" "$caddy_backup/Caddyfile"
[[ ! -f "$caddy_site" ]] || cp -a "$caddy_site" "$caddy_backup/appspace.caddy"
touch "$caddy_config"
if ! grep -Fxq 'import /etc/caddy/appspace.d/*.caddy' "$caddy_config"; then
  printf '\nimport /etc/caddy/appspace.d/*.caddy\n' >> "$caddy_config"
fi
printf '%s {\n    reverse_proxy 127.0.0.1:4173\n}\n' "$domain" > "$caddy_site"
if [[ -n "$upload_domain" ]]; then
  printf '\n%s {\n    @transfer path /api/transfer/*\n    handle @transfer {\n        reverse_proxy 127.0.0.1:4173\n    }\n    handle {\n        respond 404\n    }\n}\n' "$upload_domain" >> "$caddy_site"
fi
chmod 0644 "$caddy_config" "$caddy_site"
if ! caddy validate --config "$caddy_config" --adapter caddyfile; then
  [[ ! -f "$caddy_backup/Caddyfile" ]] || cp -a "$caddy_backup/Caddyfile" "$caddy_config"
  if [[ -f "$caddy_backup/appspace.caddy" ]]; then cp -a "$caddy_backup/appspace.caddy" "$caddy_site"; else rm -f -- "$caddy_site"; fi
  die "Caddy config invalid. Previous config restored. Backup: $caddy_backup"
fi

log 'Starting AppSpace as a system service...'
previous_release=$(readlink -f "$install_root/current" 2>/dev/null || true)
# Recheck after dependency installation, which can take a few minutes.
if systemctl is-active --quiet appspace; then
  "$node_dir/bin/node" --env-file="$config_file" "$source_dir/deploy/check-idle.mjs" || die 'A signing job started during preparation. Run the installer again after it completes.'
fi
cp -a "$config_file" "$caddy_backup/appspace.env"
if [[ $# -eq 2 ]]; then
  next_env=$(mktemp "$config_dir/.appspace-env-XXXXXXXX")
  grep -v '^UPLOAD_BASE_URL=' "$config_file" > "$next_env"
  if [[ -n "$upload_domain" ]]; then printf 'UPLOAD_BASE_URL=https://%s\n' "$upload_domain" >> "$next_env"; fi
  chmod 0600 "$next_env"
  mv -f -- "$next_env" "$config_file"
fi
ln -sfn "$release_dir" "$install_root/current"
install -m 0644 "$release_dir/deploy/appspace.service" /etc/systemd/system/appspace.service
systemctl daemon-reload
systemctl enable appspace
systemctl restart appspace
healthy=false
for ((attempt=0;attempt<30;attempt++)); do
  if curl --fail --silent --max-time 2 http://127.0.0.1:4173/healthz >/dev/null; then healthy=true; break; fi
  sleep 1
done
if [[ $healthy != true ]]; then
  cp -a "$caddy_backup/appspace.env" "$config_file"
  if [[ -n "$previous_release" && -d "$previous_release" ]]; then
    ln -sfn "$previous_release" "$install_root/current"
    systemctl restart appspace
  fi
  die 'Application did not become ready. Inspect: sudo journalctl -u appspace -n 80 --no-pager'
fi
systemctl enable caddy
if systemctl is-active --quiet caddy; then systemctl reload caddy; else systemctl start caddy; fi

log 'Installation complete. HTTPS becomes available when DNS and ports 80/443 reach this VPS.'
printf 'Public website: https://%s/\nAdmin login:    https://%s/admin\n' "$domain" "$domain"
printf 'Admin password: sudo cat /etc/appspace/admin-password.txt\n'
printf 'App data:       /var/lib/appspace\nStatus:         sudo systemctl status appspace --no-pager\n'
printf 'Backups of existing Caddy config: %s\n' "$caddy_backup"
printf 'Keep ports 80/443 reachable. Port 4173 stays private. No firewall rules were changed.\n'
if [[ -n "$upload_domain" ]]; then printf 'Direct IPA upload: https://%s (set its DNS A record to this VPS, DNS only).\n' "$upload_domain"; fi
