FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends gcc \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Persistance SQLite + JSON + logs (volume Docker recommande : /app/data)
ENV SILKGENESIS_DATA_DIR=/app/data
RUN mkdir -p /app/data && chmod 755 /app/data

EXPOSE 5000

# API (prod : definir SILKGENESIS_ENV, SILKGENESIS_ALLOWED_ORIGINS, secrets via .env)
CMD ["uvicorn", "market_server:app", "--host", "0.0.0.0", "--port", "5000", "--proxy-headers", "--forwarded-allow-ips", "*"]