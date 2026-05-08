"""
Charge market_server UNE FOIS apres configuration SILKGENESIS_*
(get_db_path() / _db_path() dans withdrawal_*, alignes avec la meme base SQLite).
"""
import os
import shutil
import sys
import tempfile

import pytest


@pytest.fixture(scope="module")
def app_ctx():
    if "market_server" in sys.modules:
        pytest.skip(
            "market_server deja charge: lancer p.ex. pytest tests/test_concurrent_orders_withdrawals.py -q"
        )
    d = tempfile.mkdtemp()
    dbp = os.path.join(d, "silkgenesis_data.db")
    old: dict[str, str | None] = {}
    for k in ("SILKGENESIS_DATA_DIR", "SILKGENESIS_DB_PATH", "SILKGENESIS_ENV", "SILKGENESIS_PEPPER"):
        old[k] = os.environ.get(k)
    try:
        os.environ["SILKGENESIS_DATA_DIR"] = d
        os.environ["SILKGENESIS_DB_PATH"] = dbp
        os.environ["SILKGENESIS_ENV"] = "development"
        if not old.get("SILKGENESIS_PEPPER"):
            os.environ["SILKGENESIS_PEPPER"] = "test_only_not_for_production_abc12"

        import market_server as ms
        from db_persist import get_db_path
        assert os.path.normpath(get_db_path()) == os.path.normpath(dbp)
        yield ms
    finally:
        for k, v in old.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
        shutil.rmtree(d, ignore_errors=True)
