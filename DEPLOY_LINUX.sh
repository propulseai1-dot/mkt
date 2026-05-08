#!/bin/bash
# SilkGenesis — installation Linux type bare metal (Tor + Nginx + API)
# Le depot doit etre present sous /opt/silkgenesis (copier le projet avant).
set -euo pipefail

ROOT="/opt/silkgenesis"
if [[ ! -d "$ROOT/api-service" ]]; then
  echo "Copier le depot sous $ROOT puis relancer."
  exit 1
fi

apt-get update -y
apt-get install -y tor nginx python3 python3-venv python3-pip nodejs npm curl

mkdir -p "$ROOT/venv" /var/lib/silkgenesis /app/frontend/build
chown www-data:www-data /var/lib/silkgenesis || true

python3 -m venv "$ROOT/venv"
"$ROOT/venv/bin/pip" install --upgrade pip
"$ROOT/venv/bin/pip" install -r "$ROOT/api-service/requirements.txt"

cd "$ROOT/frontend"
npm ci
npm run build
cp -r build/* /app/frontend/build/

cp "$ROOT/gateway/nginx.conf" /etc/nginx/nginx.conf
nginx -t
systemctl enable nginx
systemctl reload nginx

cp "$ROOT/gateway/torrc" /etc/tor/torrc
mkdir -p /var/lib/tor/silkgenesis_service
chown -R debian-tor:debian-tor /var/lib/tor/
systemctl enable tor
systemctl restart tor

if [[ ! -f "$ROOT/.env" ]]; then
  cp "$ROOT/env.example" "$ROOT/.env"
  echo ">>> Editer $ROOT/.env puis : systemctl restart silkgenesis-api"
fi

cp "$ROOT/deploy/silkgenesis-api.service" /etc/systemd/system/silkgenesis-api.service
systemctl daemon-reload
systemctl enable silkgenesis-api || true
echo "Si .env est pret : systemctl start silkgenesis-api"
echo "Adresse onion (apres ~30s) : cat /var/lib/tor/silkgenesis_service/hostname"
