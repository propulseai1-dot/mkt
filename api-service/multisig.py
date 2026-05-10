"""
SILKGENESIS - VRAIE MULTISIG MONERO 2/3
=========================================
Architecture avec 3 instances wallet-rpc separees.
Protocole complet: prepare â†’ make â†’ exchange â†’ fund â†’ sign â†’ submit

PREREQUIS:
  - monero-wallet-rpc.exe disponible dans monero-cli/
  - 3 wallets crees (marketplace, buyer_template, vendor_template)
  - Connexion a monerod (mainnet ou stagenet)

PORTS:
  - marketplace: 18082 (permanent, arbitre)
  - buyer:       18083 (cree par commande, ephemere)
  - vendor:      18084 (cree par commande, ephemere)
"""
import os
import json
import sqlite3
import secrets
import hashlib
import hmac as hmac_lib
import time
import threading
import subprocess
import requests
from requests.auth import HTTPDigestAuth
from datetime import datetime, timezone
from pathlib import Path

from secure_storage import open_secure_connection

# ============================================================
# CONFIGURATION
# ============================================================
BASE_DIR = Path(__file__).parent.absolute()
MONERO_CLI_DIR = BASE_DIR.parent / "monero-cli"
WALLETS_DIR = BASE_DIR / "multisig_wallets"
DB_PATH = BASE_DIR / "multisig.db"

# HMAC secret du journal d'audit multisig. JAMAIS de valeur par defaut connue:
# en production on refuse de demarrer, en dev on genere une valeur ephemere
# (les anciennes signatures HMAC deviennent invalides apres restart, c'est volontaire).
_IS_PRODUCTION = os.environ.get('SILKGENESIS_ENV', 'development').lower() == 'production'
_env_hmac = (os.environ.get('MULTISIG_HMAC_SECRET') or '').strip()
if _IS_PRODUCTION:
    if not _env_hmac or len(_env_hmac) < 32:
        raise RuntimeError(
            'MULTISIG_HMAC_SECRET is required in production (>= 32 chars). '
            'Generate with: openssl rand -hex 32'
        )
    HMAC_SECRET = _env_hmac
else:
    HMAC_SECRET = _env_hmac or secrets.token_hex(32)

# Reseau: 'mainnet' ou 'stagenet'
NETWORK = os.environ.get('MONERO_NETWORK', 'stagenet')
STAGENET_FLAG = '--stagenet' if NETWORK == 'stagenet' else ''

# Daemon (stagenet: P2P par defaut 127.0.0.1:38080 â€” monerod sans option)
_stagenet_default = "127.0.0.1:38080"
DAEMON_HOST = os.environ.get(
    "MONERO_DAEMON",
    _stagenet_default if NETWORK == "stagenet" else "127.0.0.1:18081",
)

# Ports wallet-rpc
PORT_MARKETPLACE = int(os.environ.get("RPC_PORT_MARKETPLACE", 18082))
PORT_BUYER_BASE  = int(os.environ.get("RPC_PORT_BUYER_BASE",  18083))
PORT_VENDOR_BASE = int(os.environ.get("RPC_PORT_VENDOR_BASE", 18084))

# Credentials RPC : jamais de defaut hardcode en production.
RPC_USER = (os.environ.get("RPC_USER") or "").strip()
RPC_PASS = (os.environ.get("RPC_PASS") or "").strip()
if _IS_PRODUCTION and (not RPC_USER or not RPC_PASS):
    raise RuntimeError(
        "RPC_USER and RPC_PASS are required in production for the multisig wallet-rpc."
    )
if not RPC_USER or not RPC_PASS:
    # En dev, on garde un fonctionnement local mais avec des valeurs aleatoires
    # (l'operateur DOIT lancer wallet-rpc avec --rpc-login matching cette valeur ;
    # voir SET_SILKGENESIS_STAGENET_ENV.bat / local_secrets.bat).
    RPC_USER = RPC_USER or "silkgenesis_dev"
    RPC_PASS = RPC_PASS or secrets.token_urlsafe(24)

# Mot de passe des wallets multisig. JAMAIS vide. Doit etre defini par l'operateur
# (variable d'environnement) et stocke dans un secret manager.
MS_WALLET_PASS = (os.environ.get("MS_WALLET_PASS") or "").strip()
if _IS_PRODUCTION and (not MS_WALLET_PASS or len(MS_WALLET_PASS) < 24):
    raise RuntimeError(
        "MS_WALLET_PASS is required in production (>= 24 chars). "
        "Generate with: openssl rand -hex 32"
    )
if not MS_WALLET_PASS:
    # Dev seulement : un mot de passe ephemere. Les wallets crees ne pourront
    # plus etre rouverts apres redemarrage (volontaire, force a regenerer).
    MS_WALLET_PASS = secrets.token_urlsafe(32)

WALLETS_DIR.mkdir(exist_ok=True)

_lock = threading.Lock()
_rpc_processes = {}  # {wallet_name: subprocess.Popen}

# ============================================================
# UTILITAIRES TEMPS
# ============================================================
def _now() -> str:
    return datetime.now(timezone.utc).isoformat()

# ============================================================
# SQLITE - SCHEMA
# ============================================================
def _init_db():
    conn = open_secure_connection(str(DB_PATH))
    c = conn.cursor()
    c.executescript('''
        CREATE TABLE IF NOT EXISTS multisig_wallets (
            order_id TEXT PRIMARY KEY,
            buyer TEXT NOT NULL,
            vendor TEXT NOT NULL,
            amount_xmr REAL NOT NULL,
            multisig_address TEXT,
            status TEXT DEFAULT 'init',
            rpc_mode TEXT DEFAULT 'pending',
            created_at TEXT NOT NULL,
            funded INTEGER DEFAULT 0,
            amount_received REAL DEFAULT 0,
            release_tx TEXT,
            refund_tx TEXT,
            dispute INTEGER DEFAULT 0,
            dispute_reason TEXT,
            dispute_opened_by TEXT,
            dispute_opened_at TEXT,
            resolution TEXT,
            resolved_by TEXT,
            resolved_at TEXT,
            released_at TEXT,
            refunded_at TEXT,
            -- Multisig key exchange data
            marketplace_prep_info TEXT,
            buyer_prep_info TEXT,
            vendor_prep_info TEXT,
            marketplace_make_info TEXT,
            buyer_make_info TEXT,
            vendor_make_info TEXT,
            keys_exchanged INTEGER DEFAULT 0,
            -- Wallet files
            buyer_wallet_file TEXT,
            vendor_wallet_file TEXT,
            marketplace_wallet_file TEXT,
            -- Ports RPC actifs
            buyer_rpc_port INTEGER,
            vendor_rpc_port INTEGER,
            -- Transaction en cours
            partial_tx_hex TEXT,
            partial_tx_submitter TEXT
        );

        CREATE TABLE IF NOT EXISTS multisig_signatures (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            order_id TEXT NOT NULL,
            signer TEXT NOT NULL,
            role TEXT NOT NULL,
            sig_hash TEXT NOT NULL,
            signed_at TEXT NOT NULL,
            entry_hmac TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS multisig_audit_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            order_id TEXT NOT NULL,
            event_type TEXT NOT NULL,
            actor TEXT NOT NULL,
            details TEXT NOT NULL,
            timestamp TEXT NOT NULL,
            entry_hmac TEXT NOT NULL
        );
    ''')
    conn.commit()
    conn.close()

_init_db()

# ============================================================
# AUDIT LOG IMMUABLE
# ============================================================
def _audit(order_id: str, event: str, actor: str, details: dict):
    ts = _now()
    d = json.dumps(details, default=str)
    msg = f"{order_id}:{event}:{actor}:{ts}:{d}"
    sig = hmac_lib.new(HMAC_SECRET.encode(), msg.encode(), hashlib.sha256).hexdigest()
    conn = open_secure_connection(str(DB_PATH))
    try:
        conn.execute(
            "INSERT INTO multisig_audit_log (order_id,event_type,actor,details,timestamp,entry_hmac) VALUES(?,?,?,?,?,?)",
            (order_id, event, actor, d, ts, sig)
        )
        conn.commit()
    finally:
        conn.close()

# ============================================================
# GESTION DES PROCESSUS WALLET-RPC
# ============================================================

def _wallet_rpc_exe() -> str:
    exe = MONERO_CLI_DIR / "monero-wallet-rpc.exe"
    if exe.exists():
        return str(exe)
    # Linux/Mac
    exe2 = MONERO_CLI_DIR / "monero-wallet-rpc"
    if exe2.exists():
        return str(exe2)
    raise FileNotFoundError(f"monero-wallet-rpc not found in {MONERO_CLI_DIR}")

def _start_wallet_rpc(wallet_file: str, port: int, wallet_name: str) -> bool:
    """Demarrer une instance wallet-rpc pour un wallet specifique"""
    if wallet_name in _rpc_processes:
        proc = _rpc_processes[wallet_name]
        if proc.poll() is None:
            return True  # Deja en cours

    try:
        exe = _wallet_rpc_exe()
        wallet_path = str(WALLETS_DIR / wallet_file)
        
        cmd = [
            exe,
            f'--wallet-file', wallet_path,
            f'--rpc-bind-port', str(port),
            f'--rpc-login', f'{RPC_USER}:{RPC_PASS}',
            f'--daemon-address', DAEMON_HOST,
            f'--log-level', '0',
            f'--trusted-daemon',
        ]
        if STAGENET_FLAG:
            cmd.append(STAGENET_FLAG)
        
        proc = subprocess.Popen(
            cmd,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0
        )
        _rpc_processes[wallet_name] = proc
        time.sleep(3)  # Attendre le startup
        
        # Verifier que le RPC repond
        if _rpc_call(port, "get_version"):
            print(f"[RPC] Started {wallet_name} on port {port}")
            return True
        else:
            print(f"[RPC] {wallet_name} started but not responding on port {port}")
            return False
    except FileNotFoundError as e:
        print(f"[RPC] Cannot start {wallet_name}: {e}")
        return False
    except Exception as e:
        print(f"[RPC] Error starting {wallet_name}: {e}")
        return False

def _create_wallet(wallet_name: str, port: int) -> bool:
    """Creer un nouveau wallet vide pour un participant"""
    try:
        exe = _wallet_rpc_exe()
        wallet_path = str(WALLETS_DIR / wallet_name)
        
        cmd = [
            exe,
            f'--generate-new-wallet', wallet_path,
            f'--rpc-bind-port', str(port),
            f'--rpc-login', f'{RPC_USER}:{RPC_PASS}',
            f'--daemon-address', DAEMON_HOST,
            f'--password', MS_WALLET_PASS,
            f'--log-level', '0',
        ]
        if STAGENET_FLAG:
            cmd.append(STAGENET_FLAG)
        
        proc = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                 creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
        _rpc_processes[wallet_name] = proc
        time.sleep(4)
        
        if _rpc_call(port, "get_version"):
            print(f"[RPC] Created new wallet {wallet_name} on port {port}")
            return True
        return False
    except Exception as e:
        print(f"[RPC] Error creating wallet {wallet_name}: {e}")
        return False

def _stop_wallet_rpc(wallet_name: str):
    """Stoper une instance wallet-rpc"""
    if wallet_name in _rpc_processes:
        proc = _rpc_processes[wallet_name]
        if proc.poll() is None:
            proc.terminate()
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                proc.kill()
        del _rpc_processes[wallet_name]
        print(f"[RPC] Stopped {wallet_name}")

# ============================================================
# APPELS RPC
# ============================================================

def _rpc_call(port: int, method: str, params: dict = None, timeout: int = 30) -> dict:
    """Appel JSON-RPC vers une instance wallet-rpc sur le port donne"""
    url = f"http://127.0.0.1:{port}/json_rpc"
    payload = {"jsonrpc": "2.0", "id": "0", "method": method, "params": params or {}}
    try:
        _auth = HTTPDigestAuth(RPC_USER, RPC_PASS) if RPC_USER and RPC_PASS else None
        resp = requests.post(url, json=payload, timeout=timeout, auth=_auth)
        if resp.status_code == 200:
            data = resp.json()
            if 'error' in data:
                print(f"[RPC:{port}] {method} error: {data['error'].get('message', data['error'])}")
            return data
    except requests.exceptions.ConnectionError:
        pass  # RPC offline
    except Exception as e:
        print(f"[RPC:{port}] {method} exception: {e}")
    return {}

def _rpc_ok(port: int) -> bool:
    """Verifier si un wallet-rpc repond"""
    r = _rpc_call(port, "get_version", timeout=3)
    return bool(r.get("result"))

# ============================================================
# PROTOCOLE MULTISIG COMPLET
# ============================================================

def _step1_prepare_all(order_id: str, buyer_port: int, vendor_port: int) -> dict:
    """
    ETAPE 1: Chaque participant appelle prepare_multisig()
    Returns les 3 multisig_info strings
    """
    print(f"[MULTISIG:{order_id}] Step 1: prepare_multisig on all 3 wallets")
    
    r_marketplace = _rpc_call(PORT_MARKETPLACE, "prepare_multisig")
    r_buyer       = _rpc_call(buyer_port,       "prepare_multisig")
    r_vendor      = _rpc_call(vendor_port,      "prepare_multisig")
    
    mp_info = r_marketplace.get("result", {}).get("multisig_info", "")
    b_info  = r_buyer.get("result", {}).get("multisig_info", "")
    v_info  = r_vendor.get("result", {}).get("multisig_info", "")
    
    if not all([mp_info, b_info, v_info]):
        missing = []
        if not mp_info: missing.append("marketplace")
        if not b_info:  missing.append("buyer")
        if not v_info:  missing.append("vendor")
        return {"success": False, "error": f"prepare_multisig failed for: {', '.join(missing)}"}
    
    print(f"[MULTISIG:{order_id}] Step 1 OK - marketplace:{mp_info[:20]}... buyer:{b_info[:20]}... vendor:{v_info[:20]}...")
    return {
        "success": True,
        "marketplace_info": mp_info,
        "buyer_info": b_info,
        "vendor_info": v_info
    }

def _step2_make_all(order_id: str, buyer_port: int, vendor_port: int,
                    mp_info: str, b_info: str, v_info: str) -> dict:
    """
    ETAPE 2: Chaque participant appelle make_multisig avec les infos des 2 autres
    Tous doivent obtenir la MEME address multisig
    """
    print(f"[MULTISIG:{order_id}] Step 2: make_multisig (threshold=2) on all 3 wallets")
    
    # marketplace.make_multisig([buyer_info, vendor_info])
    r_mp = _rpc_call(PORT_MARKETPLACE, "make_multisig", {
        "multisig_info": [b_info, v_info],
        "threshold": 2,
        "password": MS_WALLET_PASS
    })
    # buyer.make_multisig([marketplace_info, vendor_info])
    r_b = _rpc_call(buyer_port, "make_multisig", {
        "multisig_info": [mp_info, v_info],
        "threshold": 2,
        "password": MS_WALLET_PASS
    })
    # vendor.make_multisig([marketplace_info, buyer_info])
    r_v = _rpc_call(vendor_port, "make_multisig", {
        "multisig_info": [mp_info, b_info],
        "threshold": 2,
        "password": MS_WALLET_PASS
    })
    
    addr_mp = r_mp.get("result", {}).get("address", "")
    addr_b  = r_b.get("result",  {}).get("address", "")
    addr_v  = r_v.get("result",  {}).get("address", "")
    
    mp_make_info = r_mp.get("result", {}).get("multisig_info", "")
    b_make_info  = r_b.get("result",  {}).get("multisig_info", "")
    v_make_info  = r_v.get("result",  {}).get("multisig_info", "")
    
    if not all([addr_mp, addr_b, addr_v]):
        missing = []
        if not addr_mp: missing.append("marketplace")
        if not addr_b:  missing.append("buyer")
        if not addr_v:  missing.append("vendor")
        return {"success": False, "error": f"make_multisig failed for: {', '.join(missing)}"}
    
    # VERIFICATION CRITIQUE: toutes les addresss doivent etre identiques
    if not (addr_mp == addr_b == addr_v):
        return {
            "success": False,
            "error": f"Address mismatch! mp={addr_mp[:20]} b={addr_b[:20]} v={addr_v[:20]}"
        }
    
    print(f"[MULTISIG:{order_id}] Step 2 OK - All 3 wallets agree on address: {addr_mp[:30]}...")
    return {
        "success": True,
        "multisig_address": addr_mp,
        "marketplace_make_info": mp_make_info,
        "buyer_make_info": b_make_info,
        "vendor_make_info": v_make_info
    }

def _step3_exchange_keys(order_id: str, buyer_port: int, vendor_port: int,
                          mp_make_info: str, b_make_info: str, v_make_info: str) -> dict:
    """
    ETAPE 3: exchange_multisig_keys (necessaire pour certaines versions de Monero)
    Si les wallets retournent une address vide a l'etape 2, cette etape est requise.
    """
    print(f"[MULTISIG:{order_id}] Step 3: exchange_multisig_keys")
    
    # Seulement si les make_infos sont non-vides (indique qu'un echange supplementaire est requis)
    if not any([mp_make_info, b_make_info, v_make_info]):
        print(f"[MULTISIG:{order_id}] Step 3: No exchange needed (make_infos empty)")
        return {"success": True, "skipped": True}
    
    r_mp = _rpc_call(PORT_MARKETPLACE, "exchange_multisig_keys", {
        "multisig_info": [b_make_info, v_make_info],
        "password": MS_WALLET_PASS
    })
    r_b = _rpc_call(buyer_port, "exchange_multisig_keys", {
        "multisig_info": [mp_make_info, v_make_info],
        "password": MS_WALLET_PASS
    })
    r_v = _rpc_call(vendor_port, "exchange_multisig_keys", {
        "multisig_info": [mp_make_info, b_make_info],
        "password": MS_WALLET_PASS
    })
    
    addr_mp = r_mp.get("result", {}).get("address", "")
    addr_b  = r_b.get("result",  {}).get("address", "")
    addr_v  = r_v.get("result",  {}).get("address", "")
    
    if addr_mp and addr_b and addr_v:
        if addr_mp == addr_b == addr_v:
            print(f"[MULTISIG:{order_id}] Step 3 OK - Final address: {addr_mp[:30]}...")
            return {"success": True, "final_address": addr_mp}
        else:
            return {"success": False, "error": "exchange_multisig_keys address mismatch"}
    
    # Pas d'erreur si les addresss sont vides (etape optionnelle)
    return {"success": True, "skipped": True}

def _step4_create_tx(order_id: str, buyer_port: int, vendor_address: str, amount_xmr: float) -> dict:
    """
    ETAPE 4: Le buyer cree la transaction non-signee via transfer()
    Returns le tx_data_hex a faire signer par le marketplace
    """
    print(f"[MULTISIG:{order_id}] Step 4: Creating unsigned TX from buyer wallet")
    
    amount_atomic = int(amount_xmr * 1e12)  # piconero
    r = _rpc_call(buyer_port, "transfer", {
        "destinations": [{"amount": amount_atomic, "address": vendor_address}],
        "priority": 1,
        "ring_size": 11,
        "do_not_relay": True,  # Ne pas broadcaster, juste creer la tx
        "get_tx_hex": True
    })
    
    result = r.get("result", {})
    tx_hex = result.get("tx_blob", "") or result.get("tx_data_hex", "")
    tx_hash = result.get("tx_hash", "")
    
    if tx_hex:
        print(f"[MULTISIG:{order_id}] Step 4 OK - TX created: {tx_hash[:20]}...")
        return {"success": True, "tx_data_hex": tx_hex, "tx_hash": tx_hash}
    
    return {"success": False, "error": "transfer() failed - check buyer wallet balance"}

def _step5_sign_and_submit(order_id: str, tx_data_hex: str) -> dict:
    """
    ETAPE 5: Le marketplace signe et soumet la transaction
    sign_multisig(tx_data_hex) â†’ signed_hex
    submit_multisig(signed_hex) â†’ tx_hash
    """
    print(f"[MULTISIG:{order_id}] Step 5: Marketplace signs and submits TX")
    
    # Sign
    r_sign = _rpc_call(PORT_MARKETPLACE, "sign_multisig", {"tx_data_hex": tx_data_hex})
    signed_hex = r_sign.get("result", {}).get("tx_data_hex", "")
    
    if not signed_hex:
        return {"success": False, "error": "sign_multisig failed"}
    
    print(f"[MULTISIG:{order_id}] Step 5a: TX signed by marketplace")
    
    # Submit
    r_submit = _rpc_call(PORT_MARKETPLACE, "submit_multisig", {"tx_data_hex": signed_hex})
    tx_hashes = r_submit.get("result", {}).get("tx_hash_list", [])
    
    if tx_hashes:
        tx_hash = tx_hashes[0]
        print(f"[MULTISIG:{order_id}] Step 5b: TX SUBMITTED! Hash: {tx_hash}")
        return {"success": True, "tx_hash": tx_hash, "mode": "live"}
    
    return {"success": False, "error": "submit_multisig failed"}

# ============================================================
# API PUBLIQUE
# ============================================================

def create_multisig_wallet(order_id: str, buyer: str, vendor: str, amount_xmr: float) -> dict:
    """
    Cree un wallet multisig 2/3 REEL avec 3 instances wallet-rpc.
    
    Flux:
    1. Creer 2 nouveaux wallets (buyer_{order_id}, vendor_{order_id})
    2. Demarrer 3 instances wallet-rpc
    3. prepare_multisig() sur les 3
    4. make_multisig() sur les 3 â†’ address multisig identique
    5. exchange_multisig_keys() si necessaire
    """
    with _lock:
        # Verifier si deja cree
        conn = open_secure_connection(str(DB_PATH))
        conn.row_factory = sqlite3.Row
        try:
            row = conn.execute("SELECT * FROM multisig_wallets WHERE order_id=?", (order_id,)).fetchone()
            if row:
                return _load_wallet(order_id)
        finally:
            conn.close()

        # Noms des wallets pour cette commande
        buyer_wallet  = f"buyer_{order_id[:16]}"
        vendor_wallet = f"vendor_{order_id[:16]}"
        mp_wallet     = "marketplace"  # Wallet permanent

        # Ports dynamiques pour eviter les conflits
        buyer_port  = PORT_BUYER_BASE  + (hash(order_id) % 100)
        vendor_port = PORT_VENDOR_BASE + (hash(order_id) % 100)

        rpc_mode = "simulated"
        multisig_address = None
        mp_prep = b_prep = v_prep = ""
        mp_make = b_make = v_make = ""

        # Verifier si marketplace wallet-rpc est disponible
        mp_live = _rpc_ok(PORT_MARKETPLACE)
        
        if mp_live:
            print(f"[MULTISIG:{order_id}] Marketplace RPC live - starting real multisig setup")
            
            # Creer les wallets buyer et vendor
            buyer_created  = _create_wallet(buyer_wallet,  buyer_port)
            vendor_created = _create_wallet(vendor_wallet, vendor_port)
            
            if buyer_created and vendor_created:
                # ETAPE 1: prepare_multisig
                step1 = _step1_prepare_all(order_id, buyer_port, vendor_port)
                
                if step1["success"]:
                    mp_prep = step1["marketplace_info"]
                    b_prep  = step1["buyer_info"]
                    v_prep  = step1["vendor_info"]
                    
                    # ETAPE 2: make_multisig
                    step2 = _step2_make_all(order_id, buyer_port, vendor_port,
                                            mp_prep, b_prep, v_prep)
                    
                    if step2["success"]:
                        multisig_address = step2["multisig_address"]
                        mp_make = step2["marketplace_make_info"]
                        b_make  = step2["buyer_make_info"]
                        v_make  = step2["vendor_make_info"]
                        
                        # ETAPE 3: exchange_multisig_keys (si necessaire)
                        step3 = _step3_exchange_keys(order_id, buyer_port, vendor_port,
                                                      mp_make, b_make, v_make)
                        if step3.get("final_address"):
                            multisig_address = step3["final_address"]
                        
                        rpc_mode = "live"
                        print(f"[MULTISIG:{order_id}] REAL multisig address: {multisig_address}")
                    else:
                        print(f"[MULTISIG:{order_id}] make_multisig failed: {step2.get('error')}")
                else:
                    print(f"[MULTISIG:{order_id}] prepare_multisig failed: {step1.get('error')}")
            else:
                print(f"[MULTISIG:{order_id}] Could not create buyer/vendor wallets")
        else:
            print(f"[MULTISIG:{order_id}] Marketplace RPC offline - SIMULATED mode")

        if not multisig_address:
            # Mode simule - clairement marque
            seed = f"{order_id}:{buyer}:{vendor}:{amount_xmr}:{secrets.token_hex(8)}"
            h = hashlib.sha256(seed.encode()).hexdigest()
            multisig_address = f"SIMULATED_ADDR_{h[:32]}"
            rpc_mode = "simulated"
            print(f"[MULTISIG:{order_id}] WARNING: Using SIMULATED address - NOT real XMR!")

        # Save en DB
        conn = open_secure_connection(str(DB_PATH))
        try:
            conn.execute('''INSERT OR REPLACE INTO multisig_wallets (
                order_id, buyer, vendor, amount_xmr, multisig_address, status, rpc_mode,
                created_at, buyer_wallet_file, vendor_wallet_file, marketplace_wallet_file,
                buyer_rpc_port, vendor_rpc_port,
                marketplace_prep_info, buyer_prep_info, vendor_prep_info,
                marketplace_make_info, buyer_make_info, vendor_make_info,
                keys_exchanged
            ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)''', (
                order_id, buyer, vendor, amount_xmr, multisig_address,
                "awaiting_deposit", rpc_mode, _now(),
                buyer_wallet, vendor_wallet, mp_wallet,
                buyer_port if mp_live else None,
                vendor_port if mp_live else None,
                mp_prep, b_prep, v_prep,
                mp_make, b_make, v_make,
                1 if rpc_mode == "live" else 0
            ))
            conn.commit()
        finally:
            conn.close()

        _audit(order_id, "WALLET_CREATED", "system", {
            "buyer": buyer, "vendor": vendor, "amount_xmr": amount_xmr,
            "rpc_mode": rpc_mode, "address": multisig_address,
            "buyer_wallet": buyer_wallet, "vendor_wallet": vendor_wallet
        })

        return _load_wallet(order_id)


def sign_multisig(order_id: str, signer: str, role: str, tx_data_hex: str = None) -> dict:
    """
    Signer la liberation des fonds.
    
    role: 'buyer' | 'vendor' | 'marketplace'
    tx_data_hex: fourni par le buyer lors de sa signature (cree la tx non-signee)
    
    Flux reel:
    1. Buyer signe â†’ cree la tx non-signee (tx_data_hex)
    2. Marketplace signe â†’ sign_multisig(tx_data_hex) + submit_multisig()
    """
    with _lock:
        wallet = _load_wallet(order_id)
        if not wallet:
            return {"success": False, "error": "Multisig wallet not found"}

        if wallet["status"] not in ("awaiting_signatures", "funded", "awaiting_deposit", "dispute"):
            return {"success": False, "error": f"Cannot sign in status: {wallet['status']}"}

        if role not in ("buyer", "vendor", "marketplace"):
            return {"success": False, "error": f"Invalid role: {role}"}

        expected = {"buyer": wallet["buyer"], "vendor": wallet["vendor"], "marketplace": "admin"}
        if signer != expected[role]:
            return {"success": False, "error": f"Signer '{signer}' != expected '{expected[role]}'"}

        # Verifier si deja signe
        conn = open_secure_connection(str(DB_PATH))
        conn.row_factory = sqlite3.Row
        try:
            existing = conn.execute(
                "SELECT id FROM multisig_signatures WHERE order_id=? AND role=?",
                (order_id, role)
            ).fetchone()
        finally:
            conn.close()
        
        if existing:
            return {"success": False, "error": f"{role} already signed"}

        # Si le buyer fournit un tx_data_hex â†’ le stocker
        if role == "buyer" and tx_data_hex:
            conn = open_secure_connection(str(DB_PATH))
            try:
                conn.execute(
                    "UPDATE multisig_wallets SET partial_tx_hex=?, partial_tx_submitter=? WHERE order_id=?",
                    (tx_data_hex, signer, order_id)
                )
                conn.commit()
            finally:
                conn.close()
            print(f"[MULTISIG:{order_id}] Buyer provided tx_data_hex ({len(tx_data_hex)} chars)")

        # Enregistrer la signature
        sig_hash = hashlib.sha256(
            f"{order_id}:{signer}:{role}:{time.time()}:{secrets.token_hex(16)}".encode()
        ).hexdigest()
        signed_at = _now()
        msg = f"{order_id}:{signer}:{role}:{sig_hash}:{signed_at}"
        entry_hmac = hmac_lib.new(HMAC_SECRET.encode(), msg.encode(), hashlib.sha256).hexdigest()

        conn = open_secure_connection(str(DB_PATH))
        try:
            conn.execute(
                "INSERT INTO multisig_signatures (order_id,signer,role,sig_hash,signed_at,entry_hmac) VALUES(?,?,?,?,?,?)",
                (order_id, signer, role, sig_hash, signed_at, entry_hmac)
            )
            if wallet["status"] == "awaiting_deposit":
                conn.execute("UPDATE multisig_wallets SET status='awaiting_signatures' WHERE order_id=?", (order_id,))
            conn.commit()
        finally:
            conn.close()

        _audit(order_id, "SIGNATURE_ADDED", signer, {"role": role, "sig": sig_hash[:16]})

        # Compter les signatures
        conn = open_secure_connection(str(DB_PATH))
        conn.row_factory = sqlite3.Row
        try:
            sigs = conn.execute(
                "SELECT role FROM multisig_signatures WHERE order_id=?", (order_id,)
            ).fetchall()
        finally:
            conn.close()

        signed_roles = [s["role"] for s in sigs]
        signed_count = len(signed_roles)
        print(f"[MULTISIG:{order_id}] {signed_count}/2 signatures: {signed_roles}")

        result = {
            "success": True,
            "signed_count": signed_count,
            "signed_roles": signed_roles,
            "threshold": 2,
            "ready_to_release": signed_count >= 2,
            "rpc_mode": wallet.get("rpc_mode", "simulated")
        }

        if signed_count >= 2:
            release = _release_funds(order_id)
            result["release"] = release

        return result


def _release_funds(order_id: str) -> dict:
    """Liberer les fonds quand 2/3 signatures collectees"""
    wallet = _load_wallet(order_id)
    amount = wallet["amount_xmr"]
    vendor = wallet["vendor"]
    tx_hash = None
    rpc_error = None

    # Mode live: utiliser le vrai RPC
    if wallet.get("rpc_mode") == "live" and wallet.get("partial_tx_hex"):
        step5 = _step5_sign_and_submit(order_id, wallet["partial_tx_hex"])
        if step5["success"]:
            tx_hash = step5["tx_hash"]
        else:
            rpc_error = step5.get("error", "Unknown RPC error")
    elif wallet.get("rpc_mode") == "live" and not wallet.get("partial_tx_hex"):
        # Mode live mais pas de tx_data_hex â†’ le buyer doit d'abord creer la tx
        rpc_error = "Waiting for buyer to submit tx_data_hex via sign endpoint"
    else:
        rpc_error = "RPC offline - simulated mode"

    if not tx_hash:
        tx_hash = f"SIMULATED_TX_{secrets.token_hex(32)}"
        print(f"[MULTISIG:{order_id}] SIMULATED release: {amount} XMR -> {vendor}")
        if rpc_error:
            print(f"[MULTISIG:{order_id}] Reason: {rpc_error}")

    conn = open_secure_connection(str(DB_PATH))
    try:
        conn.execute(
            "UPDATE multisig_wallets SET status='completed', release_tx=?, released_at=? WHERE order_id=?",
            (tx_hash, _now(), order_id)
        )
        conn.commit()
    finally:
        conn.close()

    _audit(order_id, "FUNDS_RELEASED", "system", {
        "tx_hash": tx_hash, "amount_xmr": amount, "vendor": vendor,
        "mode": "live" if not rpc_error else "simulated",
        "rpc_error": rpc_error
    })

    # Stoper les wallets ephemeres
    _stop_wallet_rpc(f"buyer_{order_id[:16]}")
    _stop_wallet_rpc(f"vendor_{order_id[:16]}")

    return {
        "success": True,
        "tx_hash": tx_hash,
        "amount_xmr": amount,
        "vendor": vendor,
        "mode": "live" if not rpc_error else "simulated",
        "warning": rpc_error
    }


def open_dispute(order_id: str, opener: str, reason: str) -> dict:
    conn = open_secure_connection(str(DB_PATH))
    try:
        conn.execute(
            "UPDATE multisig_wallets SET dispute=1, dispute_reason=?, dispute_opened_by=?, dispute_opened_at=?, status='dispute' WHERE order_id=?",
            (reason, opener, _now(), order_id)
        )
        conn.execute("DELETE FROM multisig_signatures WHERE order_id=?", (order_id,))
        conn.commit()
    finally:
        conn.close()
    _audit(order_id, "DISPUTE_OPENED", opener, {"reason": reason})
    return {"success": True, "message": "Dispute opened. Admin will arbitrate."}


def resolve_dispute(order_id: str, admin: str, winner: str) -> dict:
    wallet = _load_wallet(order_id)
    if not wallet or not wallet.get("dispute"):
        return {"success": False, "error": "No dispute found"}

    now = _now()
    winner_role = "buyer" if winner == wallet["buyer"] else "vendor"

    # Admin + gagnant signent
    for signer, role in [(admin, "marketplace"), (winner, winner_role)]:
        sig = hashlib.sha256(f"{order_id}:{signer}:{role}:{time.time()}".encode()).hexdigest()
        msg = f"{order_id}:{signer}:{role}:{sig}:{now}"
        entry_hmac = hmac_lib.new(HMAC_SECRET.encode(), msg.encode(), hashlib.sha256).hexdigest()
        conn = open_secure_connection(str(DB_PATH))
        try:
            conn.execute(
                "INSERT OR IGNORE INTO multisig_signatures (order_id,signer,role,sig_hash,signed_at,entry_hmac) VALUES(?,?,?,?,?,?)",
                (order_id, signer, role, sig, now, entry_hmac)
            )
            conn.execute(
                "UPDATE multisig_wallets SET resolution=?, resolved_by=?, resolved_at=? WHERE order_id=?",
                (winner, admin, now, order_id)
            )
            conn.commit()
        finally:
            conn.close()

    _audit(order_id, "DISPUTE_RESOLVED", admin, {"winner": winner, "role": winner_role})

    if winner == wallet["vendor"]:
        release = _release_funds(order_id)
    else:
        tx_hash = f"SIMULATED_REFUND_{secrets.token_hex(32)}"
        conn = open_secure_connection(str(DB_PATH))
        try:
            conn.execute(
                "UPDATE multisig_wallets SET status='refunded', refund_tx=?, refunded_at=? WHERE order_id=?",
                (tx_hash, now, order_id)
            )
            conn.commit()
        finally:
            conn.close()
        _audit(order_id, "BUYER_REFUNDED", admin, {"tx_hash": tx_hash})
        release = {"success": True, "tx_hash": tx_hash, "refund": True}

    return {"success": True, "winner": winner, "resolution": "vendor_paid" if winner == wallet["vendor"] else "buyer_refunded", "release": release}


def _load_wallet(order_id: str) -> dict:
    conn = open_secure_connection(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    try:
        row = conn.execute("SELECT * FROM multisig_wallets WHERE order_id=?", (order_id,)).fetchone()
        if not row:
            return None
        w = dict(row)
        sigs = conn.execute(
            "SELECT role, signer, sig_hash, signed_at FROM multisig_signatures WHERE order_id=?", (order_id,)
        ).fetchall()
        w["signers"] = {
            "buyer":       {"signed": False, "signature": None, "signed_at": None},
            "vendor":      {"signed": False, "signature": None, "signed_at": None},
            "marketplace": {"signed": False, "signature": None, "signed_at": None}
        }
        for s in sigs:
            if s["role"] in w["signers"]:
                w["signers"][s["role"]] = {"signed": True, "signature": s["sig_hash"], "signed_at": s["signed_at"]}
        return w
    finally:
        conn.close()


def get_multisig_wallet(order_id: str) -> dict:
    return _load_wallet(order_id)


def get_all_multisig() -> list:
    conn = open_secure_connection(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    try:
        rows = conn.execute("SELECT * FROM multisig_wallets ORDER BY created_at DESC").fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def get_multisig_status_summary() -> dict:
    conn = open_secure_connection(str(DB_PATH))
    try:
        rows = conn.execute("SELECT status, amount_xmr FROM multisig_wallets").fetchall()
        wallets = [{"status": r[0], "amount_xmr": r[1]} for r in rows]
        return {
            "total": len(wallets),
            "awaiting_deposit": sum(1 for w in wallets if w["status"] == "awaiting_deposit"),
            "awaiting_signatures": sum(1 for w in wallets if w["status"] == "awaiting_signatures"),
            "completed": sum(1 for w in wallets if w["status"] == "completed"),
            "dispute": sum(1 for w in wallets if w["status"] == "dispute"),
            "refunded": sum(1 for w in wallets if w["status"] == "refunded"),
            "total_xmr_locked": round(sum(
                w["amount_xmr"] for w in wallets
                if w["status"] in ("awaiting_signatures", "dispute")
            ), 6)
        }
    finally:
        conn.close()


def get_audit_log(order_id: str = None, limit: int = 100) -> list:
    conn = open_secure_connection(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    try:
        if order_id:
            rows = conn.execute(
                "SELECT * FROM multisig_audit_log WHERE order_id=? ORDER BY id DESC LIMIT ?",
                (order_id, limit)
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM multisig_audit_log ORDER BY id DESC LIMIT ?", (limit,)
            ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


# ============================================================
# SCRIPT DE STARTUP DES 3 WALLETS RPC
# ============================================================
def start_marketplace_rpc() -> bool:
    """Demarrer le wallet-rpc marketplace (permanent)"""
    mp_wallet = str(WALLETS_DIR / "marketplace")
    
    # Creer le wallet marketplace s'il n'existe pas
    if not Path(mp_wallet + ".keys").exists():
        print(f"[MULTISIG] Creating marketplace wallet...")
        return _create_wallet("marketplace", PORT_MARKETPLACE)
    
    return _start_wallet_rpc("marketplace", PORT_MARKETPLACE, "marketplace")


# ============================================================
# TEST
# ============================================================
if __name__ == "__main__":
    import time as _t
    print("=" * 60)
    print("SILKGENESIS MULTISIG REAL - AUDIT TEST")
    print(f"Network: {NETWORK}")
    print(f"Daemon: {DAEMON_HOST}")
    print("=" * 60)

    mp_live = _rpc_ok(PORT_MARKETPLACE)
    print(f"Marketplace RPC ({PORT_MARKETPLACE}): {'LIVE' if mp_live else 'OFFLINE'}")

    if not mp_live:
        print(f"\nPour activer le vrai multisig:")
        print(f"1. Lancer monerod --{NETWORK}")
        print(f"2. Lancer: monero-wallet-rpc --{NETWORK} --wallet-file marketplace --rpc-bind-port {PORT_MARKETPLACE} --rpc-login {RPC_USER}:{RPC_PASS} --daemon-address {DAEMON_HOST}")
        print(f"3. Relancer ce test")
        print(f"\nMode SIMULATED active pour ce test.")

    test_id = f"REAL_TEST_{int(_t.time())}"
    print(f"\n[TEST] Creating 2/3 multisig wallet...")
    w = create_multisig_wallet(test_id, "alice", "bob_vendor", 0.5)
    print(f"  Address: {w['multisig_address']}")
    print(f"  Mode: {w['rpc_mode']}")
    print(f"  Keys exchanged: {w.get('keys_exchanged', 0)}")
    print(f"  Buyer wallet: {w.get('buyer_wallet_file')}")
    print(f"  Vendor wallet: {w.get('vendor_wallet_file')}")

    print(f"\n[TEST] Buyer signs...")
    r1 = sign_multisig(test_id, "alice", "buyer")
    print(f"  {r1.get('signed_count')}/2 signatures")

    print(f"\n[TEST] Vendor signs (triggers release)...")
    r2 = sign_multisig(test_id, "bob_vendor", "vendor")
    print(f"  {r2.get('signed_count')}/2 signatures")
    if r2.get("release"):
        rel = r2["release"]
        print(f"  TX: {rel.get('tx_hash', 'N/A')[:50]}")
        print(f"  Mode: {rel.get('mode')}")
        if rel.get("warning"):
            print(f"  Warning: {rel['warning']}")

    print(f"\n[AUDIT LOG]")
    for log in get_audit_log(test_id):
        print(f"  [{log['timestamp'][:19]}] {log['event_type']} by {log['actor']}")

    s = get_multisig_status_summary()
    print(f"\n[SUMMARY] {s['total']} wallets | {s['completed']} completed")
    print("=" * 60)

