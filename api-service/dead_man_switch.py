"""
SILKGENESIS - DEAD MAN SWITCH
Detecte l absence de connexion admin pendant 14 jours.
Actions: shutdown / wipe / alert
"""
import os
import json
import time
import threading
import shutil
from datetime import datetime, timedelta

from silk_paths import persist_base_dir

DMS_STATE_FILE = os.path.join(persist_base_dir(), "dead_man_state.json")
DMS_DEFAULT_INTERVAL_HOURS = 336  # 14 jours
DMS_CHECK_INTERVAL_SECONDS = 3600  # Verifier toutes les heures

_dms_state = {
    'enabled': False,
    'interval_hours': DMS_DEFAULT_INTERVAL_HOURS,
    'action': 'shutdown',
    'last_admin_login': None,
    'last_check': None,
    'triggered': False,
    'trigger_count': 0,
    'created_at': datetime.utcnow().isoformat()
}
_dms_lock = threading.Lock()
_dms_thread = None


def _load_state():
    global _dms_state
    if os.path.exists(DMS_STATE_FILE):
        try:
            from secure_storage import encrypted_json_load
            data = encrypted_json_load(DMS_STATE_FILE, default={}) or {}
            _dms_state.update(data)
            print(f"[DMS] Loaded. Enabled={_dms_state['enabled']}, Last={_dms_state.get('last_admin_login','never')}")
        except Exception as e:
            print(f"[DMS] Load error: {e}")


def _save_state():
    try:
        from secure_storage import encrypted_json_save
        encrypted_json_save(DMS_STATE_FILE, _dms_state)
    except Exception as e:
        print(f"[DMS] Save error: {e}")


def record_admin_login(username: str):
    """Appele a chaque connexion admin reussie. Remet le timer a zero."""
    with _dms_lock:
        now = datetime.utcnow().isoformat()
        _dms_state['last_admin_login'] = now
        _dms_state['last_admin_username'] = username
        _dms_state['triggered'] = False
        _save_state()
        print(f"[DMS] Admin login recorded: {username} at {now}")


def get_status() -> dict:
    """Retourner le statut actuel du Dead Man Switch"""
    with _dms_lock:
        now = datetime.utcnow()
        last_str = _dms_state.get('last_admin_login')
        ih = _dms_state.get('interval_hours', DMS_DEFAULT_INTERVAL_HOURS)
        if last_str:
            try:
                last = datetime.fromisoformat(last_str)
                hs = (now - last).total_seconds() / 3600
                hr = max(0, ih - hs)
                dl = (last + timedelta(hours=ih)).isoformat()
            except Exception:
                hs = 0
                hr = float(ih)
                dl = None
        else:
            hs = 0
            hr = float(ih)
            dl = None
        st = ('TRIGGERED' if _dms_state.get('triggered') else
              'CRITICAL' if hr < 24 else
              'WARNING' if hr < 72 else 'OK')
        return {
            'enabled': _dms_state.get('enabled', False),
            'action': _dms_state.get('action', 'shutdown'),
            'interval_hours': ih,
            'interval_days': ih / 24,
            'last_admin_login': last_str,
            'last_admin_username': _dms_state.get('last_admin_username'),
            'hours_since_last_login': round(hs, 1),
            'days_since_last_login': round(hs / 24, 1),
            'hours_remaining': round(hr, 1),
            'days_remaining': round(hr / 24, 1),
            'deadline': dl,
            'triggered': _dms_state.get('triggered', False),
            'trigger_count': _dms_state.get('trigger_count', 0),
            'status': st
        }


def configure(enabled=None, interval_hours=None, action=None):
    """Configurer le Dead Man Switch"""
    with _dms_lock:
        if enabled is not None:
            _dms_state['enabled'] = enabled
        if interval_hours is not None:
            _dms_state['interval_hours'] = max(24, interval_hours)
        if action in ('shutdown', 'wipe', 'alert'):
            _dms_state['action'] = action
        _save_state()
        print(f"[DMS] Config: enabled={_dms_state['enabled']}, interval={_dms_state['interval_hours']}h, action={_dms_state['action']}")


def _wipe_sensitive_data():
    """Supprimer les donnees sensibles avant shutdown (overwrite + delete)"""
    base = os.path.dirname(os.path.abspath(__file__))
    for fname in ['silkgenesis_data.db', 'silkgenesis.db', 'users_persist.json',
                  'vendor_listings.json', '.rpc_credentials', '.env']:
        fp = os.path.join(base, fname)
        if os.path.exists(fp):
            try:
                size = os.path.getsize(fp)
                # Overwrite with zeros before deleting
                with open(fp, 'r+b') as fh:
                    fh.write(bytes(size))
                os.remove(fp)
                print(f"[DMS] WIPED: {fp}")
            except Exception as e:
                print(f"[DMS] WIPE FAIL {fp}: {e}")
    bd = os.path.join(base, 'backups')
    if os.path.exists(bd):
        try:
            shutil.rmtree(bd)
            print(f"[DMS] WIPED: {bd}")
        except Exception as e:
            print(f"[DMS] WIPE FAIL backups: {e}")


def _execute_action():
    """Executer l action configuree quand le DMS se declenche"""
    action = _dms_state.get('action', 'shutdown')
    now = datetime.utcnow().isoformat()
    print(f"[DMS] DEAD MAN SWITCH TRIGGERED at {now} - Action: {action}")
    _dms_state['triggered'] = True
    _dms_state['trigger_count'] = _dms_state.get('trigger_count', 0) + 1
    _dms_state['triggered_at'] = now
    _save_state()
    if action == 'alert':
        print("[DMS] ALERT MODE: Logging only. No action taken.")
        return
    if action == 'wipe':
        print("[DMS] WIPE: Deleting sensitive data...")
        _wipe_sensitive_data()
    print("[DMS] SHUTDOWN in 5 seconds...")
    time.sleep(5)
    os._exit(0)


def _dms_monitor_loop():
    """Thread principal du Dead Man Switch - verifie toutes les heures"""
    print(f"[DMS] Monitor started. Checking every {DMS_CHECK_INTERVAL_SECONDS}s")
    while True:
        try:
            time.sleep(DMS_CHECK_INTERVAL_SECONDS)
            should_trigger = False
            with _dms_lock:
                if not _dms_state.get('enabled') or _dms_state.get('triggered'):
                    continue
                last_str = _dms_state.get('last_admin_login')
                ih = _dms_state.get('interval_hours', DMS_DEFAULT_INTERVAL_HOURS)
                now = datetime.utcnow()
                _dms_state['last_check'] = now.isoformat()
                if last_str:
                    try:
                        hs = (now - datetime.fromisoformat(last_str)).total_seconds() / 3600
                    except Exception:
                        hs = 0
                else:
                    try:
                        created = datetime.fromisoformat(_dms_state.get('created_at', now.isoformat()))
                        hs = (now - created).total_seconds() / 3600
                    except Exception:
                        hs = 0
                hr = ih - hs
                if hr < 24:
                    print(f"[DMS] CRITICAL: {hr:.1f}h remaining before trigger!")
                elif hr < 72:
                    print(f"[DMS] WARNING: {hr:.1f}h remaining")
                else:
                    print(f"[DMS] OK: {hr:.1f}h remaining ({hr/24:.1f} days)")
                _save_state()
                if hs >= ih:
                    should_trigger = True
            if should_trigger and not _dms_state.get('triggered'):
                _execute_action()
        except Exception as e:
            print(f"[DMS] Monitor error: {e}")


def start():
    """Demarrer le Dead Man Switch"""
    global _dms_thread
    _load_state()
    if _dms_thread is None or not _dms_thread.is_alive():
        _dms_thread = threading.Thread(target=_dms_monitor_loop, daemon=True, name='DeadManSwitch')
        _dms_thread.start()
        print(f"[DMS] Started. Enabled={_dms_state['enabled']}, "
              f"Interval={_dms_state['interval_hours']}h ({_dms_state['interval_hours']//24}d), "
              f"Action={_dms_state['action']}")
    return _dms_state


def checkin() -> dict:
    """Admin check-in manuel - reset le timer"""
    record_admin_login('manual_checkin')
    return get_status()


def status() -> dict:
    """Alias pour get_status()"""
    return get_status()


if __name__ == '__main__':
    print("[DMS TEST] Testing Dead Man Switch...")
    configure(enabled=True, interval_hours=336, action='alert')
    record_admin_login('admin')
    s = get_status()
    print(f"[DMS TEST] Status: {s['status']}")
    print(f"[DMS TEST] Days remaining: {s['days_remaining']}")
    print(f"[DMS TEST] Deadline: {s['deadline']}")
    print("[DMS TEST] OK - Dead Man Switch configured correctly")
