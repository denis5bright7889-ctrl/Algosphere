# AlgoSphere Asset Worker — Railway service
#
# Polls growth_content_items WHERE asset_state='pending' and produces
# screenshots / image cards / charts / infographics / carousels /
# blogs / PDFs / videos out-of-band, uploading results to Supabase
# Storage before flipping asset_state='ready' so the publisher picks
# them up.
#
# Base image: Playwright/python + Node (Remotion render) + ffmpeg
# (video thumbnail) + WeasyPrint native deps (cairo, pango, gdk-pixbuf)
# + matplotlib + PIL fonts. Chromium is heavy (~300MB) — keep this
# service on its own Railway plan, do not co-locate with the web app
# or signal-engine.

FROM mcr.microsoft.com/playwright/python:v1.49.0-jammy

WORKDIR /app

# System packages:
#   - fonts-dejavu-core, fonts-inter  → PIL + matplotlib branding
#   - ffmpeg                          → video thumbnail extraction
#   - WeasyPrint runtime deps         → PDF rendering
#   - curl + gnupg + ca-certificates  → bootstrap NodeSource for npx remotion
RUN apt-get update && apt-get install -y --no-install-recommends \
      fonts-dejavu-core fonts-inter \
      ffmpeg \
      libpango-1.0-0 libpangoft2-1.0-0 libcairo2 libgdk-pixbuf-2.0-0 libffi-dev \
      curl gnupg ca-certificates \
 && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
 && apt-get install -y --no-install-recommends nodejs \
 && rm -rf /var/lib/apt/lists/*

COPY apps/asset-worker/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

# Bring in the Remotion project so `npx remotion render event_video`
# resolves the composition + node_modules. The render is invoked from
# the video producer via subprocess.
COPY marketing/videos/package.json       marketing/videos/package-lock.json* /app/marketing/videos/
RUN cd /app/marketing/videos && npm install --omit=dev
COPY marketing/videos/                   /app/marketing/videos/

# Copy the rest of the worker app.
COPY apps/asset-worker/ /app/

# Default to one worker. Scale via Railway replicas if backlog grows.
CMD ["python", "-u", "worker.py"]
