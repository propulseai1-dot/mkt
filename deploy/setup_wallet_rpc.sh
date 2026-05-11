#!/bin/bash
# ============================================================
# SilkGenesis — Setup monero-wallet-rpc sur VM 250GB
# Lancer en root : bash setup_wallet_rpc.sh
# ============================================================
set -e

echo "=== SilkGenesis Wallet RPC Setup ==="

# 1. Créer l'utilisateur système monero (si pas déjà fait)
if ! id -u monero &>/dev/null; then
    useradd --system --no-create-home --shell /usr/sbin/nologin monero
    echo "[OK] Utilisateur 'monero' créé"
fi

# 2. Créer les dossiers
mkdir -p /opt/silkgenesis/wallet
mkdir -p /var/log/monero
chown -R monero:monero /opt/silkgenesis/wallet
chown -R monero:monero /var/log/monero
chmod 700 /opt/silkgenesis/wallet
echo "[OK] Dossiers créés"

# 3. Générer un mot de passe RPC fort
RPC_PASS=$(openssl rand -base64 32 | tr -d '/+=\n')
echo "silkgenesis:${RPC_PASS}" > /opt/silkgenesis/wallet/.rpc_login
chmod 600 /opt/silkgenesis/wallet/.rpc_login
chown monero:monero /opt/silkgenesis/wallet/.rpc_login
echo "[OK] Credentials RPC générés"
echo ""
echo ">>> IMPORTANT — Copie ces valeurs dans ton .env backend <<<"
echo "MONERO_RPC_USER=silkgenesis"
echo "MONERO_RPC_PASS=${RPC_PASS}"
echo "MONERO_RPC_URL=http://127.0.0.1:18082/json_rpc"
echo "============================================================"
echo ""

# 4. Demander le mot de passe wallet
echo -n "Mot de passe pour le wallet marketplace (sera stocké dans .wallet_password) : "
read -s WALLET_PASS
echo ""
echo "${WALLET_PASS}" > /opt/silkgenesis/wallet/.wallet_password
chmod 600 /opt/silkgenesis/wallet/.wallet_password
chown monero:monero /opt/silkgenesis/wallet/.wallet_password
echo "[OK] Mot de passe wallet stocké"

# 5. Créer le wallet si il n'existe pas
if [ ! -f /opt/silkgenesis/wallet/marketplace ]; then
    echo "[INFO] Création du wallet marketplace..."
    echo "Attends que monerod soit synchronisé avant de continuer."
    echo "Lance manuellement :"
    echo ""
    echo "  sudo -u monero monero-wallet-cli \\"
    echo "    --generate-new-wallet /opt/silkgenesis/wallet/marketplace \\"
    echo "    --password '${WALLET_PASS}' \\"
    echo "    --daemon-address 127.0.0.1:18081 \\"
    echo "    --log-file /var/log/monero/wallet-cli.log"
    echo ""
    echo "  Tape 'exit' une fois le wallet créé."
    echo "  NOTE L'ADRESSE PRINCIPALE — c'est l'adresse du marketplace."
else
    echo "[OK] Wallet marketplace trouvé"
fi

# 6. Installer le service systemd
cp "$(dirname "$0")/monero-wallet-rpc.service" /etc/systemd/system/
systemctl daemon-reload
systemctl enable monero-wallet-rpc
echo "[OK] Service systemd installé et activé"

# 7. Démarrer le service
if [ -f /opt/silkgenesis/wallet/marketplace ]; then
    systemctl start monero-wallet-rpc
    sleep 3
    if systemctl is-active --quiet monero-wallet-rpc; then
        echo "[OK] monero-wallet-rpc démarré"
        echo ""
        echo "=== Test de connexion RPC ==="
        curl -s -u "silkgenesis:${RPC_PASS}" \
          -X POST http://127.0.0.1:18082/json_rpc \
          -H 'Content-Type: application/json' \
          -d '{"jsonrpc":"2.0","id":"0","method":"get_version"}' | python3 -m json.tool
    else
        echo "[ERREUR] Le service n'a pas démarré. Vérifie : journalctl -u monero-wallet-rpc -n 50"
    fi
else
    echo "[INFO] Crée le wallet d'abord, puis : systemctl start monero-wallet-rpc"
fi

echo ""
echo "=== Setup terminé ==="
echo "Prochaine étape : mettre à jour /opt/silkgenesis/api-service/.env avec les valeurs ci-dessus"
