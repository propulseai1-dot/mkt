#!/bin/bash
# SilkGenesis — VM FRONT (site + Tor + Docker)
# Usage : une fois le clone fait dans ROOT, tu peux lancer :
#   chmod +x scripts/deploy-front-ubuntu.sh && ./scripts/deploy-front-ubuntu.sh
# Ou depuis n'importe où :
#   bash /opt/silkgenesis/scripts/deploy-front-ubuntu.sh

set -euo pipefail

ROOT="${SILKGENESIS_ROOT:-/opt/silkgenesis}"

if [[ ! -d "$ROOT/.git" ]]; then
  echo "ERREUR: pas de dépôt git dans $ROOT"
  echo "  git clone <url> $ROOT"
  exit 1
fi

cd "$ROOT"
echo ">>> git pull"
git pull

echo ">>> build frontend"
cd "$ROOT/frontend"
if [[ -f package-lock.json ]]; then
  npm ci
else
  npm install
fi
npm run build

echo ">>> docker compose"
cd "$ROOT"
docker compose up -d --build

echo ">>> OK. Onion (si Tor prêt) :"
docker compose exec -T gateway cat /var/lib/tor/silkgenesis_service/hostname 2>/dev/null || true
echo ">>> Health : curl -s http://127.0.0.1:8080/api/health"
