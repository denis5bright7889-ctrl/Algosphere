# copy-engine observability stack (Phase 11)

Prometheus + Alertmanager + Loki + Promtail + Grafana for the worker
cluster. **Additive** — it scrapes the metrics the workers *already* emit
(`shared/metrics.py`, `prometheus_client`); it changes no application code.

## Prerequisites

1. Workers running via `../docker-compose.yml` (creates the `algosphere`
   network this stack joins).
2. `METRICS_PORT=9100` set in the worker `.env` so each worker exposes
   `/metrics` (it defaults to `0` = off).

## Run

```bash
# from apps/copy-engine
docker compose up -d --build                     # workers + redis
# from apps/copy-engine/deploy/observability
docker compose -f docker-compose.observability.yml up -d
```

| Service | URL | Notes |
|---|---|---|
| Grafana | http://localhost:3001 | admin / `GRAFANA_ADMIN_PASSWORD` (default `admin`) — change it |
| Prometheus | http://localhost:9090 | targets under Status → Targets |
| Alertmanager | http://localhost:9093 | |
| Loki | http://localhost:3100 | queried via Grafana |

Grafana auto-provisions the Prometheus + Loki datasources and the
**AlgoSphere → Copy Engine** dashboard (queue depth, completions by status,
p95 execute latency, retries/DLQ, copy-health, kill switch, live logs).

## What's wired to real signals

- **Scrape** (`prometheus/prometheus.yml`): dns_sd over the four worker
  services on `:9100`, replica-aware (scaled executors all scraped).
- **Alerts** (`prometheus/alert.rules.yml`): queue backlog, p95 latency,
  DLQ rising, worker down, kill-switch active, retry storm, reconciliation
  divergence — all on metric names emitted by `shared/metrics.py`.
- **Logs**: Promtail ships Docker stdout (loguru JSON) to Loki, labelled by
  compose `service`/`project`.

## You must fill in
- `alertmanager/alertmanager.yml` receivers are webhook **stubs**
  (`CHANGE_ME-webhook`). Point them at your real sink (Slack/PagerDuty/
  Telegram/email) before relying on alerts.
- Set a real `GRAFANA_ADMIN_PASSWORD`.

## Scope
Covers the copy-engine workers. The signal-engine exposes its own health
endpoints (add a scrape job when it exports Prometheus metrics); the Windows
MT5 bridge is monitored via its `/health` (Phase 5), not this stack.
