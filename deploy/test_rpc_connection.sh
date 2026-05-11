#!/bin/bash
# Test rapide de la connexion monero-wallet-rpc
# Usage : bash test_rpc_connection.sh

RPC_URL="${MONERO_RPC_URL:-http://127.0.0.1:18082/json_rpc}"
RPC_USER="${MONERO_RPC_USER:-silkgenesis}"
RPC_PASS="${MONERO_RPC_PASS:-}"

if [ -z "$RPC_PASS" ]; then
    # Lire depuis le fichier si dispo
    if [ -f /opt/silkgenesis/wallet/.rpc_login ]; then
        RPC_PASS=$(cut -d: -f2 /opt/silkgenesis/wallet/.rpc_login)
    else
        echo "MONERO_RPC_PASS non défini. Source ton .env d'abord :"
        echo "  source /opt/silkgenesis/api-service/.env && bash test_rpc_connection.sh"
        exit 1
    fi
fi

echo "=== Test connexion monero-wallet-rpc ==="
echo "URL : $RPC_URL"
echo ""

echo "--- get_version ---"
curl -s --digest -u "${RPC_USER}:${RPC_PASS}" \
  -X POST "$RPC_URL" \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":"0","method":"get_version"}' | python3 -m json.tool

echo ""
echo "--- get_balance ---"
curl -s --digest -u "${RPC_USER}:${RPC_PASS}" \
  -X POST "$RPC_URL" \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":"0","method":"get_balance","params":{"account_index":0}}' | python3 -m json.tool

echo ""
echo "--- get_height ---"
curl -s --digest -u "${RPC_USER}:${RPC_PASS}" \
  -X POST "$RPC_URL" \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":"0","method":"get_height"}' | python3 -m json.tool
