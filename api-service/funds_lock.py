"""
Verrou reentrant partage pour toutes les mutations de balances / reglements.
Evite courses entre threads (HTTP sync, wallet scanner, auto-finalize) et
reduit les fenetres TOCTOU sur check-then-set des ordres.
"""
import threading

funds_rlock = threading.RLock()
