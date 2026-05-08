"""
Lanceur direct du serveur SilkGenesis
Capture toutes les erreurs et les affiche clairement
"""
import sys
import os
import traceback

os.chdir(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

print("=" * 60)
print("  SILKGENESIS - DEMARRAGE DU SERVEUR")
print("=" * 60)

try:
    import uvicorn
    print("[OK] uvicorn disponible")
except ImportError:
    print("[ERREUR] uvicorn non installe! Lancez: pip install uvicorn")
    input("Appuyez sur Entree...")
    sys.exit(1)

# Importer le module market_server pour initialiser tout
print("[...] Chargement de market_server.py...")
try:
    import market_server as ms
    print("[OK] market_server charge avec succes")
    print(f"[OK] {len(ms.users_db)} users, {len(ms.listings_db)} listings, {len(ms.categories_db)} categories")
except Exception as e:
    print(f"\n[ERREUR FATALE] market_server.py a plante:")
    print(f"  {type(e).__name__}: {e}")
    print("\nTraceback complet:")
    traceback.print_exc()
    print("\n" + "=" * 60)
    print("SOLUTION: Verifiez les dependances, les chemins, puis:")
    print("  python -m uvicorn market_server:app --host 127.0.0.1 --port 5000")
    print("=" * 60)
    input("\nAppuyez sur Entree pour fermer...")
    sys.exit(1)

# Lancer uvicorn avec l'app de market_server
print("\n" + "=" * 60)
print("  SERVEUR DEMARRE SUR http://127.0.0.1:5000")
print("  Login: admin / admin2026")
print("  Ctrl+C pour arreter")
print("=" * 60 + "\n")

try:
    uvicorn.run(ms.app, host="127.0.0.1", port=5000, log_level="info")
except OSError as e:
    if "10048" in str(e) or "address already in use" in str(e).lower():
        print(f"\n[ERREUR] Port 5000 deja utilise!")
        print("Fermez l'autre serveur d'abord (Ctrl+C dans l'autre fenetre)")
        print("Ou utilisez: taskkill /F /IM python.exe")
    else:
        print(f"\n[ERREUR] {e}")
    input("\nAppuyez sur Entree...")
    sys.exit(1)
except KeyboardInterrupt:
    print("\n[INFO] Serveur arrete par l'utilisateur")
except Exception as e:
    print(f"\n[ERREUR] {e}")
    traceback.print_exc()
    input("\nAppuyez sur Entree...")
    sys.exit(1)
