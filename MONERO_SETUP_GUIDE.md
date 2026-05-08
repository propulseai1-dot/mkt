# 🔐 GUIDE: INTÉGRATION WALLET MONERO RÉEL

## 📋 PRÉREQUIS

Pour utiliser de vraies adresses Monero et détecter les dépôts automatiquement, vous avez besoin de:

1. **Monero CLI** (monerod + monero-wallet-rpc)
2. **Un wallet Monero** synchronisé
3. **Python requests** library

---

## 🚀 ÉTAPE 1: INSTALLER MONERO

### Windows:
```bash
# Télécharger depuis: https://www.getmonero.org/downloads/
# Extraire dans C:\Monero\

# Ou via Chocolatey:
choco install monero
```

### Linux:
```bash
wget https://downloads.getmonero.org/cli/linux64
tar -xvf linux64
sudo mv monero-* /usr/local/bin/
```

---

## 🔧 ÉTAPE 2: CRÉER UN WALLET

```bash
# Créer un nouveau wallet
monero-wallet-cli --generate-new-wallet silkgenesis_wallet

# Suivre les instructions:
# 1. Entrer un mot de passe fort
# 2. Choisir une langue (English)
# 3. SAUVEGARDER LA SEED (25 mots) - CRUCIAL!
```

**⚠️ IMPORTANT:** Sauvegardez la seed dans un endroit sûr. C'est la seule façon de récupérer votre wallet!

---

## 🌐 ÉTAPE 3: SYNCHRONISER LA BLOCKCHAIN

### Option A: Node complet (recommandé pour production)
```bash
# Démarrer monerod (daemon)
monerod --detach

# Attendre la synchronisation complète (~150GB, plusieurs heures)
```

### Option B: Remote node (rapide pour dev/test)
```bash
# Utiliser un node public
monero-wallet-cli --daemon-address node.moneroworld.com:18089
```

---

## 🔌 ÉTAPE 4: DÉMARRER WALLET RPC

```bash
# Démarrer le serveur RPC
monero-wallet-rpc \
  --wallet-file silkgenesis_wallet \
  --password "VOTRE_MOT_DE_PASSE" \
  --rpc-bind-port 18082 \
  --rpc-bind-ip 127.0.0.1 \
  --daemon-address node.moneroworld.com:18089 \
  --disable-rpc-login \
  --confirm-external-bind

# Le wallet RPC écoute maintenant sur http://127.0.0.1:18082
```

**Pour production, utilisez:**
```bash
--rpc-login username:password  # Sécuriser l'accès RPC
```

---

## 🧪 ÉTAPE 5: TESTER LA CONNEXION

```bash
# Tester avec notre script
python api-service/monero_integration.py

# Vous devriez voir:
# - Création d'adresse réussie
# - Balance du wallet
# - Liste des transactions
```

---

## 🔄 ÉTAPE 6: INTÉGRER AU SERVEUR

Le fichier `market_server.py` doit être modifié pour:

### 1. Créer de vraies adresses pour chaque utilisateur
```python
from monero_integration import MoneroWallet

wallet = MoneroWallet(rpc_url="http://127.0.0.1:18082/json_rpc")

# À l'inscription
new_addr = wallet.create_address(account_index=0, label=f"user_{username}")
user["xmr_address"] = new_addr["address"]
user["address_index"] = new_addr["address_index"]
```

### 2. Vérifier les dépôts automatiquement
```python
import asyncio
from threading import Thread

async def check_deposits():
    """Vérifier les nouveaux dépôts toutes les 60 secondes"""
    while True:
        transfers = wallet.get_transfers(account_index=0, in_transfers=True)
        
        if transfers and "in" in transfers:
            for tx in transfers["in"]:
                # Vérifier si la transaction a au moins 10 confirmations
                if tx.get("confirmations", 0) >= 10:
                    amount_xmr = tx["amount"] / 1e12
                    subaddr_index = tx.get("subaddr_index", {}).get("minor", 0)
                    
                    # Trouver l'utilisateur correspondant à cette adresse
                    for username, user in users_db.items():
                        if user.get("address_index") == subaddr_index:
                            # Créditer le compte
                            user["balance"] += amount_xmr
                            print(f"✅ Deposit detected: {amount_xmr} XMR for {username}")
                            break
        
        await asyncio.sleep(60)  # Vérifier toutes les 60 secondes

# Démarrer le checker en background
Thread(target=lambda: asyncio.run(check_deposits()), daemon=True).start()
```

### 3. Envoyer des retraits
```python
@app.post("/api/wallet/withdraw")
def withdraw_funds(data: dict):
    username = data["username"]
    amount = float(data["amount"])
    address = data["address"]
    
    user = users_db[username]
    
    if user["balance"] < amount:
        return {"detail": "INSUFFICIENT_FUNDS"}, 400
    
    # Convertir XMR en atomic units (piconero)
    amount_atomic = int(amount * 1e12)
    
    # Envoyer la transaction
    tx = wallet.transfer(
        destinations=[{"address": address, "amount": amount_atomic}],
        account_index=0,
        priority=2  # Normal priority
    )
    
    if tx:
        # Déduire du balance
        user["balance"] -= amount
        
        return {
            "status": "success",
            "tx_hash": tx["tx_hash"],
            "amount": tx["amount"],
            "fee": tx["fee"]
        }
    
    return {"detail": "TRANSFER_FAILED"}, 500
```

---

## 📊 ÉTAPE 7: MONITORING

### Vérifier le statut du wallet:
```bash
curl -X POST http://127.0.0.1:18082/json_rpc \
  -d '{"jsonrpc":"2.0","id":"0","method":"get_balance"}' \
  -H 'Content-Type: application/json'
```

### Voir les adresses créées:
```bash
curl -X POST http://127.0.0.1:18082/json_rpc \
  -d '{"jsonrpc":"2.0","id":"0","method":"get_address","params":{"account_index":0}}' \
  -H 'Content-Type: application/json'
```

---

## ⚠️ SÉCURITÉ PRODUCTION

1. **Wallet chaud/froid:**
   - Wallet chaud: Petits montants pour opérations quotidiennes
   - Wallet froid: Gros montants, offline, sécurisé

2. **Backup automatique:**
   ```bash
   # Sauvegarder le wallet régulièrement
   cp silkgenesis_wallet /backup/location/
   ```

3. **Monitoring:**
   - Alertes si balance anormal
   - Logs de toutes les transactions
   - Vérification des confirmations (min 10)

4. **Rate limiting:**
   - Limiter les retraits par utilisateur/jour
   - Vérification manuelle pour gros montants

---

## 🎯 RÉSUMÉ DU FLUX

### DÉPÔT:
1. Utilisateur clique "DEPOSIT"
2. Système affiche son adresse unique
3. Utilisateur envoie XMR depuis son wallet externe
4. Background task détecte la transaction (10+ confirmations)
5. Balance mis à jour automatiquement

### RETRAIT:
1. Utilisateur demande retrait
2. Système vérifie le balance
3. Transaction envoyée via wallet RPC
4. Balance déduit immédiatement
5. Transaction confirmée sur blockchain

---

## 📦 DÉPENDANCES PYTHON

```bash
pip install requests
```

---

## 🔗 RESSOURCES

- **Monero RPC Documentation:** https://www.getmonero.org/resources/developer-guides/wallet-rpc.html
- **Monero Downloads:** https://www.getmonero.org/downloads/
- **Community:** https://reddit.com/r/Monero

---

## ⚡ QUICK START (TESTNET)

Pour tester sans risque:

```bash
# Démarrer en testnet
monerod --testnet --detach

# Créer wallet testnet
monero-wallet-cli --testnet --generate-new-wallet test_wallet

# Démarrer RPC testnet
monero-wallet-rpc \
  --testnet \
  --wallet-file test_wallet \
  --password "test123" \
  --rpc-bind-port 18082 \
  --disable-rpc-login
```

Obtenir des XMR testnet gratuits: https://testnet.xmr.to/

---

**VOTRE SYSTÈME SERA ALORS COMPLÈTEMENT FONCTIONNEL AVEC DE VRAIES TRANSACTIONS MONERO! 🚀**
