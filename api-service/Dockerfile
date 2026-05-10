FROM python:3.11-slim

# ============================================================
# SilkGenesis API service
# - Runs as a dedicated unprivileged user (silk:silk, uid/gid 10001)
# - Only trusts X-Forwarded-* from the gateway/nginx pod IP via env
#   SILKGENESIS_TRUSTED_PROXIES (defaults to a single host, never "*").
# ============================================================

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
        gcc \
        tini \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system --gid 10001 silk \
    && useradd  --system --uid 10001 --gid silk --home /app --shell /usr/sbin/nologin silk

COPY --chown=silk:silk requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY --chown=silk:silk . .

# Persistance SQLite + JSON + logs (volume Docker recommande : /app/data)
ENV SILKGENESIS_DATA_DIR=/app/data
RUN mkdir -p /app/data /app/logs \
    && chown -R silk:silk /app/data /app/logs \
    && chmod 750 /app/data /app/logs

# Le proxy de confiance doit etre fixe (jamais "*"). On le lit depuis l'env
# pour pouvoir le surcharger en compose, par defaut: l'IP du gateway interne.
ENV SILKGENESIS_TRUSTED_PROXIES=127.0.0.1

USER silk:silk

EXPOSE 5000

ENTRYPOINT ["/usr/bin/tini", "--"]

# La liste forwarded-allow-ips est interpretee a partir de la variable d'env
# (uvicorn n'accepte pas un placeholder ${}), donc on lance via shell-form.
CMD ["sh", "-c", "exec uvicorn market_server:app --host 0.0.0.0 --port 5000 --proxy-headers --forwarded-allow-ips \"${SILKGENESIS_TRUSTED_PROXIES:-127.0.0.1}\""]
