# AlgoSphere Asset Worker — Railway service
#
# Polls growth_content_items WHERE asset_state='pending' and produces
# screenshots / image cards / videos / PDFs out-of-band, uploading
# results to Supabase Storage before flipping asset_state='ready' so
# the publisher picks them up.
#
# Image: python:3.11-slim + Playwright Chromium for screenshot
# producers. Chromium is heavy (~300MB) — keep this service on its
# own Railway plan, do not co-locate with the web app or
# signal-engine.

FROM mcr.microsoft.com/playwright/python:v1.49.0-jammy

WORKDIR /app

# System fonts so PIL image cards render with the AlgoSphere brand
# font instead of a fallback bitmap font.
RUN apt-get update && apt-get install -y --no-install-recommends \
    fonts-dejavu-core fonts-inter \
 && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Default to one worker. Scale via Railway replicas if backlog grows.
CMD ["python", "-u", "worker.py"]
