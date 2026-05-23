# AlgoSphere — Observability Stack

Self-hosted Prometheus + Alertmanager + Grafana + json-exporter for the
copy-trading pipeline and MT5 bridge. Phase-1 deliverable #3 (dashboards)
built on the metrics from [`apps/copy-engine/shared/metrics.py`](../../apps/copy-engine/shared/metrics.py).

## What it shows

One Grafana dashboard (`AlgoSphere — Copy Trading Pipeline`):

- **Throughput** — queue depth, executors up, job completions by status, fan-out rate
- **Latency & reliability** — p95 engine `/execute` latency by broker, p95 job
  duration, retries by category, dead-letters by category
- **Reconciliation** — desync/orphan/partial flags by kind
- **MT5 / broker health** — `mt5_ready`, equity, targets-up, order rate vs cap

## How the pieces connect

```
copy-engine workers ──(/metrics :9101/:9102/:9103)──┐
                                                     ├─▶ Prometheus ─▶ Grafana
mt5-bridge /health ─┐                                │       │
signal-engine /health ─┴─▶ json-exporter :7979 ──────┘       └─▶ Alertmanager
```

- The workers expose **native Prometheus** on `METRICS_PORT`.
- The bridge + engine expose **JSON `/health`** only; `json-exporter` converts
  those to metrics (`mt5_bridge_*`, `signal_engine_info`) per
  [`json-exporter/config.yml`](json-exporter/config.yml) — **no change to the
  running bridge**. `up{service="mt5-bridge"}` also gives reachability for free.

## Run (local / VPS)

```bash
cd ops/observability
cp .env.example .env          # set GRAFANA_ADMIN_PASSWORD
# Edit prometheus/prometheus.yml → point the copy-* targets at your real
# worker host:port and set the two /health URLs for your environment.
docker compose up -d
```

- Grafana → http://localhost:3001 (admin / `$GRAFANA_ADMIN_PASSWORD`); the
  datasource + dashboard are auto-provisioned.
- Prometheus → http://localhost:9090 (`/alerts` shows rule state, `/targets`
  shows scrape health).
- Alertmanager → http://localhost:9093.

## Scrape targets

Prometheus does **not** expand env vars in its config, so worker hosts are set
directly in `prometheus/prometheus.yml`:

| Job | Default target | Replace with |
|---|---|---|
| copy-orchestrator | `copy-orchestrator:9101` | worker host:port |
| copy-executor | `copy-executor:9102` | each replica's host:port (or SD) |
| copy-reconciler | `copy-reconciler:9103` | worker host:port |
| mt5-bridge-health | `https://mt5.algospherequant.com/health` | your bridge URL |
| signal-engine-health | `https://signal-engine.up.railway.app/health` | your engine URL |

For workers on Railway, expose `METRICS_PORT` and target the private-network
address, or front them with a tunnel. Add executor replicas as additional
targets under the `copy-executor` job — each self-labels via its `worker`
metric label, so the dashboard aggregates them automatically.

## Alerts

Rules in [`prometheus/alerts.yml`](prometheus/alerts.yml): queue backlog/stall,
DLQ rising, p95 exec latency, high failure ratio, critical position desync,
worker down, MT5 not-ready / unreachable, engine unreachable. Routing is in
[`alertmanager/alertmanager.yml`](alertmanager/alertmanager.yml) — it boots
with a `null` receiver; wire your Telegram/Slack/PagerDuty channel in the
marked block and repoint the `critical` route.

## Notes / next slices

- **Logs (Loki):** the workers already emit structured JSON (one object per
  line). Add Loki + Promtail (or point Grafana at Railway's log drain) to
  correlate logs with metrics by `trace_id`. Not bundled here yet.
- **TLS / auth:** put Grafana behind your reverse proxy / SSO before exposing
  it publicly; the compose binds localhost ports only by default.
