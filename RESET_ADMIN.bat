@echo off
title SilkGenesis - Reset Admin Password
color 0C
echo.
echo  ============================================
echo   RESET MOT DE PASSE ADMIN
echo  ============================================
echo.

cd /d %~dp0api-service

echo Reset du compte admin en cours...
echo.

python -c "
import sqlite3, os, sys

# Essayer d'importer argon2 pour hasher le password
try:
    from argon2 import PasswordHasher
    ph = PasswordHasher(time_cost=3, memory_cost=65536, parallelism=4)
    new_hash = ph.hash('admin2026')
    method = 'argon2id'
except ImportError:
    import hashlib, secrets
    salt = secrets.token_hex(16)
    dk = hashlib.pbkdf2_hmac('sha256', 'admin2026'.encode(), salt.encode(), 260000)
    import base64
    new_hash = 'pbkdf2:sha256:260000:' + salt + ':' + base64.b64encode(dk).decode()
    method = 'pbkdf2'

db = 'silkgenesis_data.db'
if not os.path.exists(db):
    print('ERREUR: Base de donnees non trouvee!')
    print('Lance le backend une fois avant de faire le reset.')
    sys.exit(1)

conn = sqlite3.connect(db)
c = conn.cursor()

# Verifier si la table users existe
c.execute(\"SELECT name FROM sqlite_master WHERE type='table' AND name='users'\")
if not c.fetchone():
    print('ERREUR: Table users non trouvee!')
    sys.exit(1)

# Verifier si admin existe
c.execute(\"SELECT username, role FROM users WHERE username='admin'\")
row = c.fetchone()

if row:
    # Mettre a jour le password
    c.execute(\"UPDATE users SET password=?, status='active' WHERE username='admin'\", (new_hash,))
    print(f'OK: Mot de passe admin mis a jour ({method})')
else:
    # Creer le compte admin
    import secrets as s
    xmr = '4' + s.token_hex(47)
    c.execute(\"INSERT INTO users (username, password, role, status, balance, xmr_address) VALUES (?,?,?,?,?,?)\",
              ('admin', new_hash, 'admin', 'active', 1000.0, xmr))
    print(f'OK: Compte admin cree ({method})')

conn.commit()
conn.close()

print()
print('  Username : admin')
print('  Password : admin2026')
print()
print('Redemarrez le backend et connectez-vous!')
"

echo.
pause
