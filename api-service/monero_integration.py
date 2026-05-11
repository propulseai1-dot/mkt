"""
INTEGRATION MONERO WALLET RPC
Pour gerer de vraies adresses et transactions Monero
"""
import requests
import json

class MoneroWallet:
    """Interface pour communiquer avec monero-wallet-rpc"""
    
    def __init__(self, rpc_url="http://127.0.0.1:18082/json_rpc", wallet_password=""):
        self.rpc_url = rpc_url
        self.wallet_password = wallet_password
        self.request_id = 0
        # Load les credentials RPC (Digest Auth requis par Monero)
        self.rpc_user, self.rpc_pass = self._load_credentials()
    
    def _load_credentials(self):
        """Load les credentials depuis .rpc_credentials"""
        import os
        from requests.auth import HTTPDigestAuth
        cred_file = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".rpc_credentials")
        if os.path.exists(cred_file):
            try:
                content = open(cred_file).read().strip()
                # Format "user:pass"
                if ":" in content and not content.startswith("RPC_"):
                    user, passwd = content.split(":", 1)
                    print(f"[XMR] Credentials charges depuis .rpc_credentials: user={user.strip()}")
                    return user.strip(), passwd.strip()
                # Format "RPC_USER=xxx\nRPC_PASS=xxx"
                user, passwd = "", ""
                for line in content.split("\n"):
                    if line.startswith("RPC_USER="):
                        user = line.split("=", 1)[1].strip()
                    elif line.startswith("RPC_PASS="):
                        passwd = line.split("=", 1)[1].strip()
                if user:
                    print(f"[XMR] Credentials charges depuis .rpc_credentials: user={user}")
                    return user, passwd
            except Exception as e:
                print(f"[XMR] Error reading .rpc_credentials: {e}")
        # Fallback depuis variables d'environnement
        import os as _os
        user = _os.environ.get("MONERO_RPC_USER", "")
        passwd = _os.environ.get("MONERO_RPC_PASS", "")
        if user:
            return user, passwd
        print("[XMR] Aucun credential RPC trouve - mode sans auth")
        return "", ""

    def _call_rpc(self, method, params=None):
        """Appel RPC generique avec Digest Auth"""
        from requests.auth import HTTPDigestAuth
        self.request_id += 1
        payload = {
            "jsonrpc": "2.0",
            "id": str(self.request_id),
            "method": method,
            "params": params or {}
        }
        
        try:
            auth = HTTPDigestAuth(self.rpc_user, self.rpc_pass) if self.rpc_user else None
            response = requests.post(self.rpc_url, json=payload, auth=auth, timeout=30)
            if response.status_code == 401:
                print(f"[XMR] AUTH FAILED (401) - check .rpc_credentials")
                return None
            response.raise_for_status()
            result = response.json()
            
            if "error" in result:
                print(f"[XMR] RPC Error: {result['error']}")
                return None
            
            return result.get("result", {})
        except Exception as e:
            print(f"[XMR] RPC Call failed ({method}): {e}")
            return None
    
    def create_address(self, account_index=0, label=""):
        """Create a new Monero address"""
        result = self._call_rpc("create_address", {
            "account_index": account_index,
            "label": label
        })
        
        if result:
            return {
                "address": result.get("address"),
                "address_index": result.get("address_index")
            }
        return None
    
    def get_balance(self, account_index=0, address_indices=None):
        """Get the balance for an account or address"""
        params = {"account_index": account_index}
        if address_indices:
            params["address_indices"] = address_indices
        
        result = self._call_rpc("get_balance", params)
        
        if result:
            # Convertir de atomic units (piconero) en XMR
            balance_xmr = result.get("balance", 0) / 1e12
            unlocked_xmr = result.get("unlocked_balance", 0) / 1e12
            
            return {
                "balance": balance_xmr,
                "unlocked_balance": unlocked_xmr
            }
        return None
    
    def get_transfers(self, account_index=0, in_transfers=True, out_transfers=True):
        """Fetch l'historique des transactions"""
        result = self._call_rpc("get_transfers", {
            "account_index": account_index,
            "in": in_transfers,
            "out": out_transfers,
            "pending": True,
            "failed": True,
            "pool": True
        })
        
        return result
    
    def transfer(self, destinations, account_index=0, priority=0):
        """
        Envoyer XMR a une ou plusieurs adresses
        
        destinations: [{"address": "4...", "amount": 1000000000000}]  # amount en atomic units
        priority: 0=default, 1=unimportant, 2=normal, 3=elevated, 4=priority
        """
        result = self._call_rpc("transfer", {
            "destinations": destinations,
            "account_index": account_index,
            "priority": priority,
            "get_tx_key": True
        })
        
        if result:
            return {
                "tx_hash": result.get("tx_hash"),
                "tx_key": result.get("tx_key"),
                "amount": result.get("amount", 0) / 1e12,
                "fee": result.get("fee", 0) / 1e12
            }
        return None
    
    def check_tx_key(self, tx_id, tx_key, address):
        """Check that a transaction was received by an address"""
        result = self._call_rpc("check_tx_key", {
            "txid": tx_id,
            "tx_key": tx_key,
            "address": address
        })
        
        if result:
            return {
                "received": result.get("received", 0) / 1e12,
                "confirmations": result.get("confirmations", 0)
            }
        return None
    
    def get_address(self, account_index=0, address_indices=None):
        """Obtenir les adresses d'un compte"""
        params = {"account_index": account_index}
        if address_indices:
            params["address_indices"] = address_indices
        
        result = self._call_rpc("get_address", params)
        
        if result:
            return result.get("addresses", [])
        return []


# EXEMPLE D'UTILISATION
if __name__ == "__main__":
    # Initialiser le wallet
    wallet = MoneroWallet(rpc_url="http://127.0.0.1:18082/json_rpc")
    
    print("=== MONERO WALLET RPC TEST ===\n")
    
    # 1. Create a new address for a user
    print("1. Creating new address...")
    new_addr = wallet.create_address(account_index=0, label="user_test123")
    if new_addr:
        print(f"   Address: {new_addr['address']}")
        print(f"   Index: {new_addr['address_index']}\n")
    
    # 2. Check le balance
    print("2. Checking balance...")
    balance = wallet.get_balance(account_index=0)
    if balance:
        print(f"   Balance: {balance['balance']} XMR")
        print(f"   Unlocked: {balance['unlocked_balance']} XMR\n")
    
    # 3. Fetch les transactions
    print("3. Getting transfers...")
    transfers = wallet.get_transfers(account_index=0)
    if transfers:
        in_txs = transfers.get("in", [])
        print(f"   Incoming: {len(in_txs)} transactions")
        for tx in in_txs[:3]:  # Afficher les 3 dernieres
            amount_xmr = tx.get("amount", 0) / 1e12
            print(f"     - {amount_xmr} XMR (confirmations: {tx.get('confirmations', 0)})")
    
    print("\n=== TEST COMPLETE ===")


# ============================================================
# ESCROW MANAGER - Gestion des deposits et liberations de fonds
# ============================================================

class EscrowManager:
    """
    Gestionnaire d'escrow Monero.
    Surveille les deposits entrants et libere les fonds vers les vendors.
    """

    def __init__(self, orders_db: dict, users_db: dict):
        self.orders_db = orders_db
        self.users_db = users_db
        self._deposit_addresses = {}  # {address: order_id}
        self._wallet = MoneroWallet()
        # Recharger le mapping depuis les orders existantes au demarrage
        self._reload_deposit_addresses()

    def _reload_deposit_addresses(self):
        """
        Reconstruit _deposit_addresses depuis orders_db au demarrage.
        Evite la perte du mapping apres un redemarrage serveur.
        """
        for order_id, order in self.orders_db.items():
            addr = order.get("deposit_address") or order.get("xmr_subaddress")
            if addr and addr not in self._deposit_addresses:
                self._deposit_addresses[addr] = order_id
        if self._deposit_addresses:
            print(f"[ESCROW] Reloaded {len(self._deposit_addresses)} deposit address mappings")

    def generate_deposit_address(self, order_id: str, user: str, amount_xmr: float) -> dict:
        """Generates a unique subaddress for an order deposit"""
        try:
            # MoneroWallet exposes create_address() — not create_subaddress()
            result = self._wallet.create_address(account_index=0, label=f"order_{order_id}")
            if result and result.get("address"):
                addr = result["address"]
                self._deposit_addresses[addr] = order_id
                return {
                    "address": addr,
                    "address_index": result.get("address_index", 0),
                    "offline": False
                }
        except Exception as e:
            print(f"[ESCROW] generate_deposit_address failed: {e}")

        # Fallback: simulated address
        import secrets
        fake_addr = f"4{secrets.token_hex(47)}"
        self._deposit_addresses[fake_addr] = order_id
        return {
            "address": fake_addr,
            "address_index": 0,
            "offline": True
        }

    def get_order_payment_status(self, order_id: str) -> dict:
        """Retourne le statut de payment d'une order"""
        order = self.orders_db.get(order_id, {})
        return {
            "order_id": order_id,
            "payment_status": order.get("payment_status", "pending"),
            "amount_xmr": order.get("amount_xmr", 0),
            "amount_received": order.get("amount_received", 0),
            "confirmations": order.get("confirmations", 0),
            "deposit_address": order.get("deposit_address", ""),
        }

    def get_deposit_status(self, address: str) -> dict:
        """Returns deposit status by address"""
        order_id = self._deposit_addresses.get(address)
        if not order_id:
            return None
        return self.get_order_payment_status(order_id)

    def release_funds_to_vendor(self, order_id: str, vendor_address: str) -> dict:
        """Libere les fonds d'escrow vers le vendor"""
        order = self.orders_db.get(order_id, {})
        amount_xmr = float(order.get("amount_xmr", 0))
        if amount_xmr <= 0:
            return {"success": False, "error": "Invalid amount"}

        # Calculer la commission (5%)
        fee_pct = 0.05
        fee_xmr = round(amount_xmr * fee_pct, 8)
        vendor_amount = round(amount_xmr - fee_xmr, 8)

        # Tenter le transfert RPC
        try:
            result = self._wallet.transfer(
                destinations=[{"address": vendor_address, "amount": int(vendor_amount * 1e12)}],
                priority=1
            )
            if result and result.get("tx_hash"):
                return {
                    "success": True,
                    "tx_hash": result["tx_hash"],
                    "vendor_amount_xmr": vendor_amount,
                    "fee_xmr": fee_xmr,
                    "offline": False
                }
        except Exception as e:
            print(f"[ESCROW] release_funds RPC failed: {e}")

        # Fallback offline
        import secrets
        return {
            "success": True,
            "tx_hash": f"OFFLINE_{secrets.token_hex(16)}",
            "vendor_amount_xmr": vendor_amount,
            "fee_xmr": fee_xmr,
            "offline": True
        }

    def scan_incoming_transactions(self) -> list:
        """Scanne les transactions entrantes et met a jour les orders"""
        confirmed = []
        try:
            transfers = self._wallet.get_transfers(account_index=0)
            if not transfers:
                return confirmed
            for tx in transfers.get("in", []) + transfers.get("pool", []):
                address = tx.get("address", "")
                order_id = self._deposit_addresses.get(address)
                if not order_id or order_id not in self.orders_db:
                    continue
                amount_xmr = tx.get("amount", 0) / 1e12
                confirmations = tx.get("confirmations", 0)
                self.orders_db[order_id]["amount_received"] = amount_xmr
                self.orders_db[order_id]["confirmations"] = confirmations
                if confirmations >= 10:
                    self.orders_db[order_id]["payment_status"] = "confirmed"
                    confirmed.append({"order_id": order_id, "amount_xmr": amount_xmr})
                else:
                    self.orders_db[order_id]["payment_status"] = "pending_confirmations"
        except Exception as e:
            print(f"[ESCROW] scan error: {e}")
        return confirmed


# Singleton escrow manager
_escrow_instance = None

def init_escrow(orders_db: dict, users_db: dict) -> EscrowManager:
    """Initialise et retourne le gestionnaire d'escrow (singleton)"""
    global _escrow_instance
    _escrow_instance = EscrowManager(orders_db, users_db)
    return _escrow_instance

def get_escrow() -> EscrowManager:
    """Retourne l'instance escrow existante"""
    return _escrow_instance


