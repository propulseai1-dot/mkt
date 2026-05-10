"""
SILKGENESIS - Configuration centrale
Commissions, niveaux vendeurs, limites de retrait
"""
import re

# ============================================================
# VENDOR LEVELS & TIERED COMMISSIONS
# ============================================================
# Aligné sur api-service/market_server.VENDOR_LEVELS (seuils en ventes complétées)
VENDOR_LEVELS = [
    {
        "level": 1,
        "name": "Newcomer",
        "icon": "🆕",
        "min_sales": 0,
        "max_sales": 49,
        "commission_rate": 0.08,
        "color": "#888888",
        "badge": "NEWCOMER",
    },
    {
        "level": 2,
        "name": "Bronze",
        "icon": "🥉",
        "min_sales": 50,
        "max_sales": 99,
        "commission_rate": 0.07,
        "color": "#cd7f32",
        "badge": "BRONZE",
    },
    {
        "level": 3,
        "name": "Silver",
        "icon": "🥈",
        "min_sales": 100,
        "max_sales": 299,
        "commission_rate": 0.06,
        "color": "#c0c0c0",
        "badge": "SILVER",
    },
    {
        "level": 4,
        "name": "Gold",
        "icon": "🥇",
        "min_sales": 300,
        "max_sales": 599,
        "commission_rate": 0.05,
        "color": "#ffd700",
        "badge": "GOLD",
    },
    {
        "level": 5,
        "name": "Platinum",
        "icon": "💎",
        "min_sales": 600,
        "max_sales": 1199,
        "commission_rate": 0.035,
        "color": "#e5e4e2",
        "badge": "PLATINUM",
    },
    {
        "level": 6,
        "name": "Elite",
        "icon": "👑",
        "min_sales": 1200,
        "max_sales": None,
        "commission_rate": 0.02,
        "color": "#ff6b35",
        "badge": "ELITE",
    },
]

# ============================================================
# WITHDRAWAL SETTINGS
# ============================================================
MIN_WITHDRAWAL_XMR = 0.001          # Minimum withdrawal amount
MAX_WITHDRAWAL_XMR = 100.0          # Maximum per transaction
WITHDRAWAL_NETWORK_FEE_XMR = 0.0001 # Estimated Monero network fee (gas)
WITHDRAWAL_COOLDOWN_SECONDS = 300   # 5 min between withdrawals

# ============================================================
# ESCROW SETTINGS
# ============================================================
AUTO_FINALIZE_DAYS = 7              # Days before auto-release
MIN_CONFIRMATIONS = 10              # Blockchain confirmations required
MARKETPLACE_FEE_PERCENT = 8.0      # Default (overridden by vendor level)

# ============================================================
# HELPER FUNCTIONS
# ============================================================

def get_vendor_level_info(total_sales: int) -> dict:
    """
    Returns the vendor level dict based on total_sales.
    Always returns the highest applicable level.
    """
    current_level = VENDOR_LEVELS[0]
    for lvl in VENDOR_LEVELS:
        if total_sales >= lvl["min_sales"]:
            current_level = lvl
    return current_level


def get_next_level_info(total_sales: int) -> dict | None:
    """
    Returns the next level dict, or None if already at max level.
    """
    current = get_vendor_level_info(total_sales)
    current_idx = next((i for i, l in enumerate(VENDOR_LEVELS) if l["level"] == current["level"]), 0)
    if current_idx + 1 < len(VENDOR_LEVELS):
        return VENDOR_LEVELS[current_idx + 1]
    return None


def calculate_commission(amount_xmr: float, total_sales: int) -> dict:
    """
    Calculate commission and vendor net amount based on vendor level.
    
    Returns:
        {
            "gross_xmr": float,       # Total escrow amount
            "commission_rate": float,  # e.g. 0.08
            "commission_xmr": float,   # Fee taken by marketplace
            "net_xmr": float,          # Amount vendor receives
            "level": dict              # Vendor level info
        }
    """
    level = get_vendor_level_info(total_sales)
    rate = level["commission_rate"]
    commission = round(amount_xmr * rate, 8)
    net = round(amount_xmr - commission, 8)
    
    return {
        "gross_xmr": round(amount_xmr, 8),
        "commission_rate": rate,
        "commission_pct": round(rate * 100, 1),
        "commission_xmr": commission,
        "net_xmr": net,
        "level": level
    }


def check_level_up(old_sales: int, new_sales: int) -> dict | None:
    """
    Check if a vendor leveled up between old_sales and new_sales.
    Returns the new level dict if leveled up, else None.
    """
    old_level = get_vendor_level_info(old_sales)
    new_level = get_vendor_level_info(new_sales)
    if new_level["level"] > old_level["level"]:
        return new_level
    return None


def validate_xmr_address(address: str) -> bool:
    """
    Basic Monero address validation.
    - Standard address: starts with '4', length 95
    - Subaddress: starts with '8', length 95
    - Integrated address: starts with '4', length 106
    """
    if not address or not isinstance(address, str):
        return False
    address = address.strip()
    base58_re = re.compile(r"^[123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]+$")
    if len(address) == 95 and address[0] in ('4', '8') and base58_re.match(address):
        return True
    if len(address) == 106 and address[0] == '4' and base58_re.match(address):
        return True
    return False
