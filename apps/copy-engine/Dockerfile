# AlgoSphere copy-engine worker image.
# ADDITIVE: production currently deploys these workers on Railway via
# Nixpacks (railway.json + Procfile). This Dockerfile is the self-hosted
# path for a dedicated Linux worker VPS; it does not change the Railway
# deploy. One image, one command override per worker (see docker-compose.yml
# / supervisord.conf).
FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# procps → pgrep, used by the compose healthchecks. tini → correct PID-1
# signal handling so SIGTERM reaches the asyncio loop for clean shutdown.
RUN apt-get update \
    && apt-get install -y --no-install-recommends procps tini \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install -r requirements.txt

COPY . .

# Run as non-root.
RUN useradd --create-home --uid 10001 worker \
    && chown -R worker:worker /app
USER worker

ENTRYPOINT ["/usr/bin/tini", "--"]
# Default is the orchestrator; compose/supervisor override per service.
CMD ["python", "orchestrator.py"]
