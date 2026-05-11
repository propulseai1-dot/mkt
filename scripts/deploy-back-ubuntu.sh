#!/bin/bash
# SilkGenesis — VM BACK (Monero)
set -euo pipefail

ROOT="${SILKGENESIS_ROOT:-/opt/silkgenesis}"

if [[ -d "$ROOT/.git" ]]; then
  cd "$ROOT"
  echo ">>> git pull ($ROOT)"
  git pull
else
  echo ">>> Pas de dépôt git dans $ROOT — ignoré."
fi

echo ">>> redémarrage systemd Monero (ignore si pas installé ainsi)"
sudo systemctl try-restart monerod 2>/dev/null || true
sudo systemctl try-restart monero-wallet-rpc 2>/dev/null || true

echo ">>> Terminé. Si tu lances wallet-rpc à la main (tmux), relance-le toi-même."
