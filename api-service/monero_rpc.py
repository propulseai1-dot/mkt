

import builtins
import requests
from requests.auth import HTTPDigestAuth
import json
import time
import threading
import logging
import os
from datetime import datetime, timezone
from typing import Optional, Dict, List, Any

from funds_lock import funds_rlock

# ============================================================
# CONFIGURATION
# ============================================================
MONERO_RPC_URL = os.environ.get("MONERO_RPC_URL", "http://127.0.0.1:18082/json_rpc")
IS_PRODUCTION = os.environ.get("SILKGENESIS_ENV", "development").lower() == "production"

_VERBOSE_LOGS = (not IS_PRODUCTION) or (
    os.environ.get("SILKGENESIS_VERBOSE_LOGS", "").strip().lower() in ("1", "true", "yes", "on")
)


def _dev__dev_print(*args, **kwargs) -> None:
    if not _VERBOSE_LOGS:
        return
    builtins._dev_print(*args, **kwargs, flush=True)


# ============================================================
# AUTHENTIFICATION RPC - Lue depuis variable d'environnement
# or .rpc_credentials file (never hardcoded in source)
# ============================================================
def _load_rpc_credentials():
    """
    Charge les credentials RPC depuis:
    1. Variables d'environnement (priorite haute)
    2. Fallback: pas d'auth (mode dev local uniquement)
    
    SECURITY: Les credentials ne sont JAMAIS stockes en clair
    dans le code source. Utilisez les variables d'environnement
    or the .rpc_credentials file (added to .gitignore).
    """
    # 1. Variables d'environnement (recommande en production)
    env_user = os.environ.get("MONERO_RPC_USER", "")
    env_pass = os.environ.get("MONERO_RPC_PASS", "")
    if env_user and env_pass:
        _dev_print(f"[XMR AUTH] Using RPC credentials from environment variables")
        return env_user, env_pass
    
    if IS_PRODUCTION:
        raise RuntimeError("MONERO_RPC_USER and MONERO_RPC_PASS are required in production.")

    # 2. Fallback: pas d'auth (mode dev - RPC sans login)
    _dev_print("[XMR AUTH] No RPC credentials found - running without auth (development only)")
    _dev_print("[XMR AUTH] For production: set MONERO_RPC_USER and MONERO_RPC_PASS env vars")
    return "", ""

MONERO_RPC_USER, MONERO_RPC_PASS = _load_rpc_credentials()

MARKETPLACE_FEE_PERCENT = 2.5  # 2.5% de frais marketplace
MIN_CONFIRMATIONS = 10         # Confirmations requises avant validation
SCAN_INTERVAL_SECONDS = 60     # Scan toutes les 60 secondes
ATOMIC_UNIT = 1e12             # 1 XMR = 1,000,000,000,000 piconero

# ============================================================
# LOGGING FINANCIER (interne uniquement)
# ============================================================
fin_logger = logging.getLogger("silkgenesis.finance")
fin_logger.setLevel(logging.INFO)

# Create le dossier logs si necessaire
LOG_DIR = os.path.join(os.path.dirname(__file__), "logs")
os.makedirs(LOG_DIR, exist_ok=True)

_fh = logging.FileHandler(os.path.join(LOG_DIR, "financial_transactions.log"))
_fh.setFormatter(logging.Formatter('%(asctime)s [%(levelname)s] %(message)s'))
fin_logger.addHandler(_fh)

def log_financial(event: str, data: dict):
    """Log financier interne - jamais expose au frontend"""
    fin_logger.info(f"[{event}] {json.dumps(data, default=str)}")


# ============================================================
# MONERO RPC CLIENT
# ============================================================
class MoneroRPC:
    """Monero RPC client - secure local connection"""
    
    def __init__(self, rpc_url: str = MONERO_RPC_URL):
        self.rpc_url = rpc_url
        self._request_id = 0
        self._lock = threading.Lock()
        self._connected = False
        self._last_check = 0
    
    def _call(self, method: str, params: dict = None) -> Optional[dict]:
        """Appel RPC JSON avec gestion d'erreurs"""
        with self._lock:
            self._request_id += 1
            req_id = self._request_id
        
        payload = {
            "jsonrpc": "2.0",
            "id": str(req_id),
            "method": method,
            "params": params or {}
        }
        
        try:
            # Monero wallet-rpc uses HTTP Digest Auth (NOT Basic Auth)
            auth = None
            if MONERO_RPC_USER and MONERO_RPC_PASS:
                auth = HTTPDigestAuth(MONERO_RPC_USER, MONERO_RPC_PASS)
            
            resp = requests.post(
                self.rpc_url,
                json=payload,
                auth=auth,
                timeout=30,
                headers={"Content-Type": "application/json"}
            )
            resp.raise_for_status()
            result = resp.json()
            
            if "error" in result:
                err = result["error"]
                _dev_print(f"[XMR RPC ERROR] {method}: {err.get('message', err)}")
                return None
            
            self._connected = True
            return result.get("result", {})
        
        except requests.exceptions.ConnectionError:
            if self._connected:
                _dev_print(f"[XMR] Lost connection to monero-wallet-rpc at {self.rpc_url}")
                self._connected = False
            return None
        except Exception as e:
            _dev_print(f"[XMR RPC] {method} failed: {e}")
            return None
    
    def is_connected(self) -> bool:
        """Checks si le RPC est accessible"""
        now = time.time()
        if now - self._last_check < 10:
            return self._connected
        self._last_check = now
        result = self._call("get_version")
        self._connected = result is not None
        return self._connected
    
    def get_version(self) -> Optional[dict]:
        return self._call("get_version")
    
    def get_height(self) -> Optional[int]:
        result = self._call("get_height")
        return result.get("height") if result else None
    
    def get_balance(self, account_index: int = 0, address_indices: List[int] = None) -> Optional[dict]:
        """Balance en XMR (converti depuis piconero)"""
        params = {"account_index": account_index}
        if address_indices:
            params["address_indices"] = address_indices
        result = self._call("get_balance", params)
        if result:
            return {
                "balance_xmr": result.get("balance", 0) / ATOMIC_UNIT,
                "unlocked_xmr": result.get("unlocked_balance", 0) / ATOMIC_UNIT,
                "balance_atomic": result.get("balance", 0),
                "unlocked_atomic": result.get("unlocked_balance", 0),
                "per_subaddress": result.get("per_subaddress", [])
            }
        return None
    
    def create_subaddress(self, account_index: int = 0, label: str = "") -> Optional[dict]:
        """Creates a new unique subaddress"""
        result = self._call("create_address", {
            "account_index": account_index,
            "label": label
        })
        if result:
            return {
                "address": result.get("address"),
                "address_index": result.get("address_index")
            }
        return None
    
    def create_address(self, account_index: int = 0, label: str = "") -> dict:
        """Creates a new unique subaddress (Subaddress)"""
        params = {
            "account_index": account_index,
            "label": label
        }
        result = self._call("create_address", params)
        if result:
            return {
                "address": result.get("address"),
                "address_index": result.get("address_index")
            }
        return None
    
    def get_transfers(self, account_index: int = 0, min_height: int = 0) -> Optional[dict]:
        """Recupere toutes les transactions entrantes/sortantes"""
        result = self._call("get_transfers", {
            "account_index": account_index,
            "in": True,
            "out": True,
            "pending": True,
            "failed": False,
            "pool": True,
            "min_height": min_height,
            "filter_by_height": min_height > 0
        })
        return result
    
    def get_transfer_by_txid(self, txid: str) -> Optional[dict]:
        """Recupere une transaction par son hash"""
        result = self._call("get_transfer_by_txid", {"txid": txid})
        return result.get("transfer") if result else None
    
    def transfer(self, destinations: List[dict], account_index: int = 0, priority: int = 2) -> Optional[dict]:
        """
        Envoie XMR a une ou plusieurs adresses.
        destinations: [{"address": "4...", "amount": 1000000000000}]  # amount en piconero
        priority: 1=unimportant, 2=normal, 3=elevated, 4=priority
        """
        result = self._call("transfer", {
            "destinations": destinations,
            "account_index": account_index,
            "priority": priority,
            "get_tx_key": True,
            "do_not_relay": False
        })
        if result:
            return {
                "tx_hash": result.get("tx_hash"),
                "tx_key": result.get("tx_key"),
                "amount_xmr": result.get("amount", 0) / ATOMIC_UNIT,
                "fee_xmr": result.get("fee", 0) / ATOMIC_UNIT,
                "amount_atomic": result.get("amount", 0),
                "fee_atomic": result.get("fee", 0)
            }
        return None
    
    def check_tx_key(self, txid: str, tx_key: str, address: str) -> Optional[dict]:
        """Checks qu'une transaction a bien ete recue"""
        result = self._call("check_tx_key", {
            "txid": txid,
            "tx_key": tx_key,
            "address": address
        })
        if result:
            return {
                "received_xmr": result.get("received", 0) / ATOMIC_UNIT,
                "confirmations": result.get("confirmations", 0),
                "in_pool": result.get("in_pool", False)
            }
        return None
    
    def sweep_all(self, address: str, account_index: int = 0) -> Optional[dict]:
        """Sends the entire available balance to an address"""
        result = self._call("sweep_all", {
            "address": address,
            "account_index": account_index,
            "priority": 2,
            "get_tx_keys": True
        })
        return result


# ============================================================
# ESCROW MANAGER
# ============================================================
class EscrowManager:
    """
    Gestion de l'escrow Monero pour SilkGenesis.
    Tous les fonds passent par le Master Wallet marketplace.
    """
    
    def __init__(self, rpc: MoneroRPC, orders_db: dict, users_db: dict):
        self.rpc = rpc
        self.orders_db = orders_db
        self.users_db = users_db
        
        # Pending deposits DB: {address: {order_id, amount_expected, user, created_at}}
        self.pending_deposits: Dict[str, dict] = {}
        
        # DB des transactions confirmedes: {txid: {amount, address, confirmations, order_id}}
        self.confirmed_txs: Dict[str, dict] = {}
        
        # Hauteur de bloc du dernier scan
        self.last_scan_height: int = 0
        
        # Thread de scan
        self._scan_thread: Optional[threading.Thread] = None
        self._running = False
    
    def generate_deposit_address(self, order_id: str, user: str, amount_xmr: float) -> Optional[dict]:
        """
        Generates a unique subaddress for a deposit.
        Liee a un order_id specifique.
        """
        if not self.rpc.is_connected():
            if IS_PRODUCTION:
                return None
            # Mode offline local: retourner une simulated address
            fake_addr = f"4SilkGenesis{order_id[:8]}OFFLINE{user[:6]}XMR"
            log_financial("DEPOSIT_ADDRESS_OFFLINE", {
                "order_id": order_id,
                "user": user,
                "amount_xmr": amount_xmr,
                "address": fake_addr
            })
            return {
                "address": fake_addr,
                "address_index": 0,
                "offline": True
            }
        
        label = f"order_{order_id}_{user}"
        result = self.rpc.create_subaddress(account_index=0, label=label)
        
        if result and result.get("address"):
            addr = result["address"]
            addr_idx = result["address_index"]
            
            # Record pending deposit
            self.pending_deposits[addr] = {
                "order_id": order_id,
                "user": user,
                "amount_expected_xmr": amount_xmr,
                "amount_expected_atomic": int(amount_xmr * ATOMIC_UNIT),
                "address_index": addr_idx,
                "created_at": datetime.now(timezone.utc).isoformat(),
                "status": "pending",
                "received_xmr": 0.0,
                "confirmations": 0,
                "txid": None
            }
            
            log_financial("DEPOSIT_ADDRESS_CREATED", {
                "order_id": order_id,
                "user": user,
                "address": addr,
                "address_index": addr_idx,
                "amount_expected_xmr": amount_xmr
            })
            
            return {
                "address": addr,
                "address_index": addr_idx,
                "offline": False
            }
        
        return None
    
    def generate_user_deposit_address(self, username: str) -> Optional[dict]:
        """Generates a deposit address for a user balance"""
        if not self.rpc.is_connected():
            return None
        
        label = f"user_{username}_deposit"
        result = self.rpc.create_subaddress(account_index=0, label=label)
        
        if result and result.get("address"):
            log_financial("USER_DEPOSIT_ADDRESS_CREATED", {
                "user": username,
                "address": result["address"]
            })
            return result
        return None
    
    def scan_incoming_transactions(self) -> List[dict]:
        """
        Scanne les transactions entrantes.
        Appele par le background task toutes les 60 secondes.
        Retourne la liste des transactions nouvellement confirmedes.
        """
        if not self.rpc.is_connected():
            return []
        
        newly_confirmed = []
        
        try:
            transfers = self.rpc.get_transfers(account_index=0, min_height=self.last_scan_height)
            if not transfers:
                return []
            
            incoming = transfers.get("in", []) + transfers.get("pool", [])
            
            for tx in incoming:
                txid = tx.get("txid") or tx.get("tx_hash", "")
                amount_atomic = tx.get("amount", 0)
                amount_xmr = amount_atomic / ATOMIC_UNIT
                confirmations = tx.get("confirmations", 0)
                address = tx.get("address", "")
                subaddr_index = tx.get("subaddr_index", {})
                height = tx.get("height", 0)
                
                # Mettre a jour la hauteur de scan
                if height > self.last_scan_height:
                    self.last_scan_height = height
                
                # Check if this address is pending
                if address in self.pending_deposits:
                    deposit = self.pending_deposits[address]
                    deposit["received_xmr"] = amount_xmr
                    deposit["confirmations"] = confirmations
                    deposit["txid"] = txid
                    
                    log_financial("TX_DETECTED", {
                        "txid": txid,
                        "address": address,
                        "amount_xmr": amount_xmr,
                        "confirmations": confirmations,
                        "order_id": deposit.get("order_id")
                    })
                    
                    # Check si suffisamment confirmed
                    if confirmations >= MIN_CONFIRMATIONS and txid not in self.confirmed_txs:
                        deposit["status"] = "confirmed"
                        self.confirmed_txs[txid] = {
                            "address": address,
                            "amount_xmr": amount_xmr,
                            "confirmations": confirmations,
                            "order_id": deposit.get("order_id"),
                            "user": deposit.get("user"),
                            "confirmed_at": datetime.now(timezone.utc).isoformat()
                        }
                        
                        # Mettre a jour la order
                        order_id = deposit.get("order_id")
                        if order_id and order_id in self.orders_db:
                            self.orders_db[order_id]["payment_status"] = "confirmed"
                            self.orders_db[order_id]["payment_txid"] = txid
                            self.orders_db[order_id]["payment_amount_xmr"] = amount_xmr
                            self.orders_db[order_id]["payment_confirmations"] = confirmations
                            if self.orders_db[order_id].get("status") == "pending_payment":
                                self.orders_db[order_id]["status"] = "processing"
                        
                        log_financial("TX_CONFIRMED", {
                            "txid": txid,
                            "address": address,
                            "amount_xmr": amount_xmr,
                            "confirmations": confirmations,
                            "order_id": deposit.get("order_id"),
                            "user": deposit.get("user")
                        })
                        
                        newly_confirmed.append({
                            "txid": txid,
                            "address": address,
                            "amount_xmr": amount_xmr,
                            "order_id": deposit.get("order_id"),
                            "user": deposit.get("user")
                        })
        
        except Exception as e:
            _dev_print(f"[XMR SCAN ERROR] {e}")
        
        return newly_confirmed
    
    def release_funds_to_vendor(self, order_id: str, vendor_address: str) -> Optional[dict]:
        """
        Libere les fonds escrow vers le vendor apres confirmation du buyer.
        Deduit les frais marketplace automatiquement.
        """
        if order_id not in self.orders_db:
            return {"error": "ORDER_NOT_FOUND"}
        
        order = self.orders_db[order_id]
        
        if order.get("payment_status") != "confirmed":
            return {"error": "PAYMENT_NOT_CONFIRMED"}
        
        if order.get("escrow_status") == "released":
            return {"error": "FUNDS_ALREADY_RELEASED"}
        
        amount_xmr = order.get("payment_amount_xmr", 0)
        if amount_xmr <= 0:
            return {"error": "INVALID_AMOUNT"}
        
        # Calculer les frais marketplace
        fee_xmr = amount_xmr * (MARKETPLACE_FEE_PERCENT / 100)
        vendor_amount_xmr = amount_xmr - fee_xmr
        vendor_amount_atomic = int(vendor_amount_xmr * ATOMIC_UNIT)
        
        log_financial("ESCROW_RELEASE_INITIATED", {
            "order_id": order_id,
            "vendor_address": vendor_address,
            "total_xmr": amount_xmr,
            "fee_xmr": fee_xmr,
            "vendor_amount_xmr": vendor_amount_xmr,
            "fee_percent": MARKETPLACE_FEE_PERCENT
        })
        
        if not self.rpc.is_connected():
            if IS_PRODUCTION:
                return {"error": "RPC_UNAVAILABLE"}
            with funds_rlock:
                # Mode offline local: simuler le release
                order["escrow_status"] = "released"
                order["vendor_payout_xmr"] = vendor_amount_xmr
                order["marketplace_fee_xmr"] = fee_xmr
                order["release_tx"] = "OFFLINE_SIMULATED"
                vendor = order.get("vendor")
                if vendor and vendor in self.users_db:
                    self.users_db[vendor]["balance"] = self.users_db[vendor].get("balance", 0) + vendor_amount_xmr
                    self.users_db[vendor]["total_sales"] = self.users_db[vendor].get("total_sales", 0) + 1
                    self.users_db[vendor]["total_volume_xmr"] = self.users_db[vendor].get("total_volume_xmr", 0) + vendor_amount_xmr
            return {
                "success": True,
                "tx_hash": "OFFLINE_SIMULATED",
                "vendor_amount_xmr": vendor_amount_xmr,
                "fee_xmr": fee_xmr,
                "offline": True
            }
        
        # Envoyer les fonds au vendor
        result = self.rpc.transfer(
            destinations=[{"address": vendor_address, "amount": vendor_amount_atomic}],
            account_index=0,
            priority=2
        )
        
        if result:
            with funds_rlock:
                order["escrow_status"] = "released"
                order["vendor_payout_xmr"] = vendor_amount_xmr
                order["marketplace_fee_xmr"] = fee_xmr
                order["release_tx"] = result["tx_hash"]
                vendor = order.get("vendor")
                if vendor and vendor in self.users_db:
                    self.users_db[vendor]["balance"] = self.users_db[vendor].get("balance", 0) + vendor_amount_xmr
                    self.users_db[vendor]["total_sales"] = self.users_db[vendor].get("total_sales", 0) + 1
                    self.users_db[vendor]["total_volume_xmr"] = self.users_db[vendor].get("total_volume_xmr", 0) + vendor_amount_xmr
            log_financial("ESCROW_RELEASED", {
                "order_id": order_id,
                "tx_hash": result["tx_hash"],
                "vendor_amount_xmr": vendor_amount_xmr,
                "fee_xmr": fee_xmr,
                "fee_percent": MARKETPLACE_FEE_PERCENT
            })
            
            return {
                "success": True,
                "tx_hash": result["tx_hash"],
                "vendor_amount_xmr": vendor_amount_xmr,
                "fee_xmr": fee_xmr,
                "offline": False
            }
        
        return {"error": "TRANSFER_FAILED"}
    
    def withdraw_vendor_balance(self, vendor: str, destination_address: str, amount_xmr: float) -> Optional[dict]:
        """
        Allows a vendor to withdraw balance to an external address.
        Deduit les frais de reseau Monero.
        """
        if vendor not in self.users_db:
            return {"error": "USER_NOT_FOUND"}
        
        with funds_rlock:
            user = self.users_db[vendor]
            available_balance = user.get("balance", 0)
            if amount_xmr > available_balance:
                return {"error": "INSUFFICIENT_BALANCE", "available": available_balance}
            if amount_xmr <= 0:
                return {"error": "INVALID_AMOUNT"}
        
        if not destination_address or not (destination_address.startswith('4') or destination_address.startswith('8')):
            return {"error": "INVALID_XMR_ADDRESS"}
        
        amount_atomic = int(amount_xmr * ATOMIC_UNIT)
        
        log_financial("WITHDRAWAL_INITIATED", {
            "vendor": vendor,
            "destination": destination_address,
            "amount_xmr": amount_xmr
        })
        
        if not self.rpc.is_connected():
            if IS_PRODUCTION:
                return {"error": "RPC_UNAVAILABLE"}
            with funds_rlock:
                user = self.users_db[vendor]
                ab = float(user.get("balance", 0))
                if amount_xmr > ab:
                    return {"error": "INSUFFICIENT_BALANCE", "available": ab}
                user["balance"] = ab - amount_xmr
                new_bal = user["balance"]
            log_financial("WITHDRAWAL_OFFLINE", {
                "vendor": vendor,
                "amount_xmr": amount_xmr,
                "destination": destination_address
            })
            return {
                "success": True,
                "tx_hash": "OFFLINE_SIMULATED",
                "amount_xmr": amount_xmr,
                "new_balance": new_bal,
                "offline": True
            }
        
        result = self.rpc.transfer(
            destinations=[{"address": destination_address, "amount": amount_atomic}],
            account_index=0,
            priority=2
        )
        
        if result:
            actual_amount = result["amount_xmr"]
            with funds_rlock:
                user = self.users_db[vendor]
                ab = float(user.get("balance", 0))
                user["balance"] = max(0, ab - actual_amount)
                new_bal = user["balance"]
            log_financial("WITHDRAWAL_COMPLETED", {
                "vendor": vendor,
                "tx_hash": result["tx_hash"],
                "amount_xmr": actual_amount,
                "fee_xmr": result["fee_xmr"],
                "destination": destination_address,
                "new_balance": new_bal
            })
            return {
                "success": True,
                "tx_hash": result["tx_hash"],
                "amount_xmr": actual_amount,
                "fee_xmr": result["fee_xmr"],
                "new_balance": new_bal,
                "offline": False
            }
        
        return {"error": "TRANSFER_FAILED"}
    
    def get_deposit_status(self, address: str) -> Optional[dict]:
        """Returns status of a pending deposit"""
        if address in self.pending_deposits:
            dep = self.pending_deposits[address].copy()
            dep["confirmations_needed"] = max(0, MIN_CONFIRMATIONS - dep.get("confirmations", 0))
            dep["progress_percent"] = min(100, int((dep.get("confirmations", 0) / MIN_CONFIRMATIONS) * 100))
            return dep
        return None
    
    def get_order_payment_status(self, order_id: str) -> dict:
        """Retourne le statut de payment d'une order"""
        if order_id not in self.orders_db:
            return {"error": "ORDER_NOT_FOUND"}
        
        order = self.orders_db[order_id]
        deposit_addr = order.get("deposit_address")
        
        status = {
            "order_id": order_id,
            "payment_status": order.get("payment_status", "pending"),
            "escrow_status": order.get("escrow_status", "holding"),
            "deposit_address": deposit_addr,
            "amount_expected_xmr": order.get("amount_xmr", 0),
            "amount_received_xmr": order.get("payment_amount_xmr", 0),
            "confirmations": order.get("payment_confirmations", 0),
            "confirmations_needed": MIN_CONFIRMATIONS,
            "txid": order.get("payment_txid"),
            "rpc_connected": self.rpc.is_connected()
        }
        
        # Enrich with pending deposit data
        if deposit_addr and deposit_addr in self.pending_deposits:
            dep = self.pending_deposits[deposit_addr]
            status["confirmations"] = dep.get("confirmations", 0)
            status["amount_received_xmr"] = dep.get("received_xmr", 0)
        
        return status
    
    def start_scanner(self):
        """Demarre le thread de scan in the background"""
        if self._running:
            return
        self._running = True
        self._scan_thread = threading.Thread(target=self._scan_loop, daemon=True)
        self._scan_thread.start()
        _dev_print(f"[XMR SCANNER] Started - scanning every {SCAN_INTERVAL_SECONDS}s")
    
    def stop_scanner(self):
        """Stop le thread de scan"""
        self._running = False
        if self._scan_thread:
            self._scan_thread.join(timeout=5)
        _dev_print("[XMR SCANNER] Stopped")
    
    def _scan_loop(self):
        """Boucle de scan in the background"""
        while self._running:
            try:
                confirmed = self.scan_incoming_transactions()
                if confirmed:
                    _dev_print(f"[XMR SCANNER] {len(confirmed)} new confirmed transaction(s)")
                    for tx in confirmed:
                        _dev_print(f"  ✓ {tx['amount_xmr']:.6f} XMR - Order: {tx['order_id']}")
            except Exception as e:
                _dev_print(f"[XMR SCANNER ERROR] {e}")
            
            time.sleep(SCAN_INTERVAL_SECONDS)


# ============================================================
# INSTANCE GLOBALE (initialisee dans market_server.py)
# ============================================================
_rpc_instance: Optional[MoneroRPC] = None
_escrow_instance: Optional[EscrowManager] = None


def get_rpc() -> MoneroRPC:
    global _rpc_instance
    if _rpc_instance is None:
        _rpc_instance = MoneroRPC(MONERO_RPC_URL)
    return _rpc_instance


def get_escrow(orders_db: dict = None, users_db: dict = None) -> EscrowManager:
    global _escrow_instance
    if _escrow_instance is None and orders_db is not None and users_db is not None:
        _escrow_instance = EscrowManager(get_rpc(), orders_db, users_db)
    return _escrow_instance


def init_escrow(orders_db: dict, users_db: dict) -> EscrowManager:
    """Initialise et demarre le systeme escrow"""
    global _escrow_instance
    rpc = get_rpc()
    _escrow_instance = EscrowManager(rpc, orders_db, users_db)
    _escrow_instance.start_scanner()
    
    # Check RPC connection
    if rpc.is_connected():
        version = rpc.get_version()
        _dev_print(f"[XMR] Connected to monero-wallet-rpc v{version}")
        balance = rpc.get_balance()
        if balance:
            _dev_print(f"[XMR] Master Wallet Balance: {balance['balance_xmr']:.6f} XMR (unlocked: {balance['unlocked_xmr']:.6f} XMR)")
    else:
        _dev_print(f"[XMR] WARNING: monero-wallet-rpc not available at {MONERO_RPC_URL}")
        if IS_PRODUCTION:
            raise RuntimeError("RPC unavailable in production. Refusing to start with simulated mode.")
        _dev_print(f"[XMR] Running in OFFLINE mode - transactions may be simulated (development only)")
    
    return _escrow_instance



