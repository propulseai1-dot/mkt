"""
Chemins de persistance centralises (Docker / prod Tor).
SILKGENESIS_DATA_DIR : repertoire unique pour SQLite, JSON, bonds, DMS, logs.
"""
import os


def persist_base_dir() -> str:
    d = os.environ.get("SILKGENESIS_DATA_DIR", "").strip()
    if d:
        p = os.path.abspath(d)
        os.makedirs(p, exist_ok=True)
        return p
    return os.path.dirname(os.path.abspath(__file__))


def ensure_silk_data_layout() -> None:
    """Si SILKGENESIS_DATA_DIR est defini, fixe SILKGENESIS_DB_PATH par defaut."""
    d = os.environ.get("SILKGENESIS_DATA_DIR", "").strip()
    if not d:
        return
    base = persist_base_dir()
    if not os.environ.get("SILKGENESIS_DB_PATH", "").strip():
        os.environ["SILKGENESIS_DB_PATH"] = os.path.join(base, "silkgenesis_data.db")
