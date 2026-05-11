# SilkGenesis — Guide de déploiement (référence rapide)

Ce document regroupe **tout ce qu’il faut pour builder / lancer** le projet, notamment :

- **Une seule machine** (Docker Compose + Tor)  
- **Deux VMs** (ex. GCP) : VM **backend Monero** + VM **front** (site + Tor + API)  

### Blocs copier-coller — ce que tu colles sur chaque Ubuntu

**Prérequis une fois** : le dépôt est cloné au même chemin sur chaque VM (ou seulement sur la front pour le back minimal) :

```bash
sudo mkdir -p /opt && sudo chown "$USER":"$USER" /opt
cd /opt && git clone https://github.com/VOTRE_ORG/VOTRE_REPO.git silkgenesis
```

*(Remplace l’URL ; pour un repo privé : SSH ou token.)*

---

#### VM **front** (site, Tor, API Docker) — pull + build + relancer la stack

Colle **tout le bloc** dans le terminal :

```bash
cd /opt/silkgenesis && git pull && cd frontend && (test -f package-lock.json && npm ci || npm install) && npm run build && cd .. && docker compose up -d --build
```

Ou avec le script du dépôt (même effet, messages plus clairs) :

```bash
chmod +x /opt/silkgenesis/scripts/deploy-front-ubuntu.sh
SILKGENESIS_ROOT=/opt/silkgenesis /opt/silkgenesis/scripts/deploy-front-ubuntu.sh
```

---

#### VM **back** (monerod + wallet-rpc uniquement)

Colle **tout le bloc** :

```bash
cd /opt/silkgenesis 2>/dev/null && git pull || true
sudo systemctl try-restart monerod 2>/dev/null || true
sudo systemctl try-restart monero-wallet-rpc 2>/dev/null || true
```

- Si tu **n’as pas** cloné le repo sur le back, la ligne `git pull` ne fait rien de grave (`|| true`).
- Si Monero tourne dans **tmux** et pas en **systemd**, après `git pull` il n’y a souvent **rien à redémarrer** côté Monero ; relance manuelle seulement si tu as changé la config.

Script équivalent : `scripts/deploy-back-ubuntu.sh`

---

Fichiers complémentaires dans le dépôt :

| Fichier | Contenu |
|---------|---------|
| `scripts/deploy-front-ubuntu.sh` | Pull + `npm` build + `docker compose up` (VM front) |
| `scripts/deploy-back-ubuntu.sh` | Pull optionnel + `try-restart` monerod / wallet-rpc (VM back) |
| `GUIDE_DEPLOIEMENT_TOR.md` | Détail Tor, bare metal (systemd + nginx + tor), checklist |
| `env.example` | Template `.env` (copier vers `.env`, **ne jamais committer**) |
| `DEPLOY_LINUX.sh` | Installation bare metal Linux (hors Docker) |
| `docker-compose.yml` | Stack prod : `gateway` (Tor+Nginx) + `api` + `price-oracle` |

---

## Prérequis communs

- **Git**, **Docker** + plugin **Compose** v2 (`docker compose`)
- Sur la VM **front** : **Node.js** + **npm** (pour `npm run build` du React avant Docker)
- Fichier **`.env`** à la racine du dépôt : `cp env.example .env` puis éditer

Chemins utilisés ci-dessous : **`/opt/silkgenesis`** (adapte si tu clones ailleurs, ex. `~/mkt`).

---

## Mode A — Une seule machine (tout sur le même serveur)

Utile pour test ou petit serveur où **monerod** + **monero-wallet-rpc** tournent **sur la même machine** que Docker.

### 1) Configuration

```bash
cd /opt/silkgenesis
cp env.example .env
nano .env
```

- `MONERO_RPC_URL` : par défaut le `docker-compose.yml` pointe vers  
  `http://host.docker.internal:18082/json_rpc` (wallet sur **l’hôte** Linux/Windows).  
  Sur **Linux pur**, ajoute dans `docker-compose.yml` sous `api` :  
  `extra_hosts: - "host.docker.internal:host-gateway"` (souvent **déjà présent** dans ce repo).

### 2) Build frontend + lancer la stack

```bash
cd /opt/silkgenesis
cd frontend && npm install && npm run build && cd ..
docker compose up -d --build
```

*(Si `package-lock.json` est versionné et à jour, tu peux utiliser `npm ci` à la place de `npm install`.)*

### 3) Adresse onion + vérif

```bash
docker compose exec gateway cat /var/lib/tor/silkgenesis_service/hostname
curl -s http://127.0.0.1:8080/api/health
```

Mets à jour `.env` : `SILKGENESIS_ALLOWED_ORIGINS=http://TON_HOSTNAME.onion` puis :

```bash
docker compose up -d
```

---

## Mode B — Deux VMs (recommandé sur GCP : Monero isolé)

**Exemple de répartition :**

| Rôle | Exemple IP interne | Contenu |
|------|---------------------|---------|
| **Backend** | `10.128.0.4` | `monerod` + `monero-wallet-rpc` (RPC uniquement vers la VM front) |
| **Front** | `10.128.0.7` | Repo SilkGenesis + `docker compose` (API + oracle + gateway Tor + build React) |

### VM Backend (Monero) — « build » = compiler / lancer les binaires Monero

Ce n’est **pas** un `npm run build`. Étapes typiques :

1. **Pare-feu GCP** : autoriser **TCP 18082** (ou ton port RPC) **uniquement depuis** l’IP interne de la VM front (ex. `10.128.0.7/32`), **pas** depuis Internet.

2. **UFW** (si activé) sur la VM back :

   ```bash
   sudo ufw allow from 10.128.0.7 to any port 18082 proto tcp
   ```

3. **Daemon** (sync blockchain ; laisse tourner) :

   ```bash
   monerod --detach
   # ou : monerod   (dans tmux/screen)
   ```

4. **Wallet RPC** — doit accepter les connexions **depuis le réseau VPC** (pas seulement 127.0.0.1 si l’API est sur une autre VM) :

   ```bash
   monero-wallet-rpc \
     --wallet-file CHEMIN/VERS/WALLET \
     --password "MOT_DE_PASSE_WALLET" \
     --rpc-bind-ip 0.0.0.0 \
     --rpc-bind-port 18082 \
     --rpc-login MONERO_USER:MONERO_PASS \
     --daemon-address 127.0.0.1:18081 \
     --confirm-external-bind
   ```

   Utilise le **même** `MONERO_USER` / `MONERO_PASS` que dans le `.env` de la VM front.

5. **Test depuis la VM backend** :

   ```bash
   curl -s --digest -u MONERO_USER:MONERO_PASS \
     -H 'Content-Type: application/json' \
     -d '{"jsonrpc":"2.0","id":"0","method":"get_version"}' \
     http://127.0.0.1:18082/json_rpc
   ```

6. **Test depuis la VM front** (une fois le réseau OK) :

   ```bash
   curl -s --digest -u MONERO_USER:MONERO_PASS \
     -H 'Content-Type: application/json' \
     -d '{"jsonrpc":"2.0","id":"0","method":"get_version"}' \
     http://10.128.0.4:18082/json_rpc
   ```

   (Remplace `10.128.0.4` par l’IP interne réelle du back.)

---

### VM Front (SilkGenesis + Tor) — « build » du site

#### Première installation

```bash
sudo mkdir -p /opt && sudo chown "$USER":"$USER" /opt
cd /opt
git clone https://github.com/VOTRE_ORG/VOTRE_REPO.git silkgenesis
cd silkgenesis
cp env.example .env
nano .env
```

**Important (2 VMs)** dans `.env` :

```bash
MONERO_RPC_URL=http://10.128.0.4:18082/json_rpc
MONERO_RPC_USER=...   # identique au --rpc-login du wallet-rpc
MONERO_RPC_PASS=...
```

Ne **pas** utiliser `host.docker.internal` pour joindre l’autre VM ; utiliser l’**IP interne** du backend.

Renseigner aussi obligatoirement en prod : `SILKGENESIS_ENV`, `SILKGENESIS_ALLOWED_ORIGINS` (après première onion), `SILKGENESIS_DB_KEY`, `SILKGENESIS_PEPPER`, `PRICE_ORACLE_TOKEN`, mots de passe admin, etc. (voir commentaires dans `env.example`).

#### Commande courte — mise à jour + build + redémarrage (à réutiliser à chaque déploiement)

```bash
cd /opt/silkgenesis && git pull && cd frontend && npm install && npm run build && cd .. && docker compose up -d --build
```

Si tu as un `package-lock.json` fiable et à jour :

```bash
cd /opt/silkgenesis && git pull && cd frontend && npm ci && npm run build && cd .. && docker compose up -d --build
```

#### Après le premier `up` : hostname onion

```bash
cd /opt/silkgenesis
docker compose exec gateway cat /var/lib/tor/silkgenesis_service/hostname
```

Copie `http://XXXX.onion` dans `SILKGENESIS_ALLOWED_ORIGINS`, puis :

```bash
docker compose up -d
```

#### Vérifications

```bash
curl -s http://127.0.0.1:8080/api/health
docker compose ps
docker compose logs -f api --tail 80
```

---

## Récap « quelle commande sur quelle VM »

| VM | Action | Commande type |
|----|--------|-----------------|
| **Back** | Lancer blockchain | `monerod` (voir doc Monero) |
| **Back** | Lancer RPC pour le site | `monero-wallet-rpc ... --rpc-bind-ip 0.0.0.0 ...` |
| **Front** | Build UI + stack Docker | `cd /opt/silkgenesis && git pull && cd frontend && npm install && npm run build && cd .. && docker compose up -d --build` |
| **Front** | Lire l’onion | `docker compose exec gateway cat /var/lib/tor/silkgenesis_service/hostname` |

---

## Dépannage rapide

| Problème | Piste |
|----------|--------|
| `cd: /opt/silkgenesis: No such file` | Cloner le dépôt une première fois (`git clone ... /opt/silkgenesis`). |
| `npm ci` échoue (pas de lockfile) | Utiliser `npm install` dans `frontend/`. |
| `docker compose`: no configuration file | Lancer depuis la **racine** du repo (là où est `docker-compose.yml`). |
| API ne joint pas Monero | Vérifier `MONERO_RPC_URL`, pare-feu GCP, `UFW`, et que le wallet écoute sur `0.0.0.0`. |
| Digest auth | Le client Python de l’API utilise l’auth attendue par `monero-wallet-rpc` ; login = `.env`. |
| CORS / cookies | `SILKGENESIS_ALLOWED_ORIGINS` doit être **exactement** l’URL `http://....onion` utilisée dans Tor Browser. |

---

## Profil Docker optionnel : Monero dans un conteneur (même VM que le front)

Sur **une** machine, tu peux lancer aussi le service `monero-rpc` du `docker-compose.yml` avec le profile `bundled-monero` — voir commentaires dans `docker-compose.yml`. Dans ce cas adapte `MONERO_RPC_URL` vers ce service. Sur **deux VMs**, le cas le plus courant reste **Monero sur la VM dédiée back**.

---

## Sécurité (rappel)

- Ne **commite** jamais `.env`, clés, `.db` ou mots de passe.  
- N’expose **pas** le port RPC Monero sur l’IP publique ; seulement **réseau interne + Tor** pour l’UI.  
- Sauvegarder les **volumes Docker** (`silkgenesis_prod_data`, données Tor) selon votre politique.

---

*Dernière mise à jour du guide : aligné sur `docker-compose.yml` et `env.example` du dépôt.*
