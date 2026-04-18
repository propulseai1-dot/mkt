FROM python:3.11-slim

WORKDIR /app

# Installation des dépendances système pour PostgreSQL
RUN apt-get update && apt-get install -y libpq-dev gcc && apt-get clean

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Lancement de l'API sur le port 5000
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "5000"]