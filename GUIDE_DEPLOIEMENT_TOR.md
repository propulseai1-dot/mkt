# GUIDE DÉPLOIEMENT TOR — SILKGENESIS
## Production — Hidden Service v3

---

## Deux modes recommandés

### A) Docker Compose (recommandé)

1. `cp env.example .env` puis éditer `.env` (obligatoire : `SILKGENESIS_ALLOWED_ORIGINS` avec l’URL `http://….onion`, mots de passe, RPC Monero).
2. `cd frontend && npm ci && npm run build`
3. Préparer le wallet dans `./monero-data/` et aligner `MONERO_RPC_*` avec le conteneur `monero-rpc`.
4. `docker compose up -d --build`
5. Lire l’adresse onion : `docker compose exec gateway cat /var/lib/tor/silkgenesis_service/hostname`  
   (ou le fichier sur l’hôte : `gateway/tor-data/silkgenesis_service/hostname` si monté en bind.)
6. Mettre à jour `.env` avec l’URL exacte si besoin, puis `docker compose up -d` pour recharger l’API.

**Persistance** : volume Docker `silkgenesis_prod_data` → `/app/data` (SQLite, `users_persist.json`, `vendor_listings.json`, bonds, DMS, logs). **Sauvegarder ce volume.**

**Base de données** : l’API utilise **SQLite** (`db_persist`), pas PostgreSQL.

---

### B) Bare metal (Tor + Nginx + uvicorn)

## PRÉREQUIS (Ubuntu/Debian)

```bash
apt install tor nginx python3 python3-venv nodejs npm
```

```bash
python3 -m venv /opt/silkgenesis/venv
/opt/silkgenesis/venv/bin/pip install -r /opt/silkgenesis/api-service/requirements.txt
cd /opt/silkgenesis/frontend && npm ci && npm run build
```

---

## ÉTAPE 1 — Build frontend

```bash
cd /opt/silkgenesis/frontend
npm run build
mkdir -p /app/frontend/build
cp -r build/* /app/frontend/build/
```

---

## ÉTAPE 2 — Nginx

```bash
cp /opt/silkgenesis/gateway/nginx.conf /etc/nginx/nginx.conf
nginx -t && systemctl reload nginx
```

`gateway/nginx.conf` : pas de `limit_req` par adresse IP (inadapté derrière un hidden service où tout arrive souvent comme `127.0.0.1`). Le rate limiting reste côté **FastAPI**.

---

## ÉTAPE 3 — Tor

```bash
cp /opt/silkgenesis/gateway/torrc /etc/tor/torrc
mkdir -p /var/lib/tor/silkgenesis_service
chown -R debian-tor:debian-tor /var/lib/tor/
systemctl enable tor && systemctl restart tor
sleep 25
cat /var/lib/tor/silkgenesis_service/hostname
```

---

## ÉTAPE 4 — API (uvicorn) + données

Créer le répertoire de persistance et le fichier d’environnement :

```bash
sudo mkdir -p /var/lib/silkgenesis
sudo chown www-data:www-data /var/lib/silkgenesis
sudo nano /opt/silkgenesis/.env
```

Contenu minimal de `/opt/silkgenesis/.env` :

```bash
SILKGENESIS_ENV=production
SILKGENESIS_ALLOWED_ORIGINS=http://VOTRE.onion
SILKGENESIS_BOOTSTRAP_ADMIN_PASSWORD=mot_de_passe_admin_initial_fort
MONERO_RPC_USER=...
MONERO_RPC_PASS=...
MONERO_RPC_URL=http://127.0.0.1:18082/json_rpc
```

Installer l’unité systemd :

```bash
sudo cp /opt/silkgenesis/deploy/silkgenesis-api.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable silkgenesis-api --now
```

L’unité définit `SILKGENESIS_DATA_DIR=/var/lib/silkgenesis` (SQLite, JSON, bonds, dead-man, logs d’audit).

---

## ÉTAPE 5 — Vérifications

```bash
curl -s http://127.0.0.1:5000/api/health
curl -s http://127.0.0.1/health
```

Puis ouvrir dans **Tor Browser** : `http://<hostname>.onion`

---

## Monero (production)

En production, l’API **refuse de démarrer** si le RPC wallet n’est pas joignable avec `MONERO_RPC_USER` / `MONERO_RPC_PASS` définis.

Démarrer `monero-wallet-rpc` en local (127.0.0.1) avec digest auth, aligné sur `MONERO_RPC_URL` et les variables ci-dessus. Sauvegarder la **seed** du wallet hors ligne.

---

## Sécurité / opérations

- **CORS** : `SILKGENESIS_ALLOWED_ORIGINS` doit inclure l’URL exacte du site (ex. `http://xxxx.onion`). Plusieurs origines possibles, séparées par des virgules.
- **Admin** : le mot de passe bootstrap est imposé en prod via `SILKGENESIS_BOOTSTRAP_ADMIN_PASSWORD`.
- **Backups SQLite** : automatiques dans `<SILKGENESIS_DATA_DIR>/backups/` (cf. `db_persist`).
- Les routes `/api/emergency/*` du code sont **désactivées (404)** ; ne pas s’appuyer sur des « reset » d’urgence via HTTP.

---

## Backup manuel (admin authentifié)

Utiliser les endpoints admin documentés dans l’application (session Bearer), pas d’exemple avec mot de passe en clair sur la ligne de commande.
