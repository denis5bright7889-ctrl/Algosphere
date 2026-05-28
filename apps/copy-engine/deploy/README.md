# copy-engine — self-hosted worker deployment

**Additive and optional.** Production runs these workers on Railway
(`../railway.json` + `../Procfile`); nothing here changes that. Use this for
a dedicated Linux worker VPS.

## Topology

```
Vercel (web)                       Windows VPS (MT5 bridge, single-instance)
     │                                        ▲
     ▼                                        │ /execute (engine owns brokers)
signal-engine (Railway or VPS) ───────────────┘
     ▲
     │ SIGNAL_ENGINE_URL  (workers never import broker SDKs)
worker VPS  ── this folder ──┐
   orchestrator / executor(×N) / reconciler / coach
   Redis (queue wakeup + streams)
```

The worker VPS holds **no broker credentials** and never places trades
directly — it routes through the engine `/api/v1/execute` (12-gate,
idempotent). Only the engine + bridge touch brokers.

## Option A — Docker Compose (one container per worker)

```bash
cp .env.example .env          # fill SUPABASE_*, SIGNAL_ENGINE_URL, ENGINE_API_KEY, REDIS_URL
docker compose up -d --build
docker compose up -d --scale executor=3     # scale the hot worker
docker compose ps
docker compose logs -f executor
```

`executor` is horizontally scalable: `claim_copy_jobs` uses
`FOR UPDATE SKIP LOCKED` and orders carry an idempotent
`client_order_id = copy_<job_id>`, so N executors never double-process or
double-fill. orchestrator / reconciler / coach are singletons (one each).

## Option B — Supervisor (all workers under one supervisor)

```bash
pip install -r requirements.txt supervisor
supervisord -c deploy/supervisord.conf
supervisorctl -c deploy/supervisord.conf status
```

Set `REDIS_URL` to a reachable Redis. `numprocs=2` on `executor` runs two
executor processes; raise it to scale.

## Health & recovery

- Compose healthchecks are process-liveness (`pgrep`); `restart:
  unless-stopped` + `restartPolicyMaxRetries` recover crashes. Supervisor
  uses `autorestart=true` + `startretries=10`.
- Workers handle SIGTERM (tini as PID 1 / supervisor `stopsignal=TERM`) and
  drain the current claim within `stop_grace_period` (30s).
- Metrics/logs: see `deploy/observability/` for the Prometheus/Grafana/Loki
  stack that scrapes these workers.

## What this does NOT include
- The signal-engine and the Windows MT5 bridge (separate hosts/lifecycles).
- Secrets — `.env` is git-ignored; never commit broker or service keys.
