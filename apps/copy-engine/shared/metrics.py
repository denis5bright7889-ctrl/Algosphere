"""
copy-engine — Prometheus metrics.

Each worker starts a tiny HTTP server (prometheus_client) on METRICS_PORT
so Prometheus can scrape /metrics. Metric names are namespaced
`algosphere_copy_*` and labelled by worker + broker + status so one
Grafana dashboard renders the whole copy-trading pipeline.

Importing this module is cheap and side-effect-free; nothing binds a port
until start_metrics_server() is called. If prometheus_client is missing
the module degrades to no-op stubs — metrics are observability, never a
hard dependency of execution (preserves "no blocking paths").
"""
from __future__ import annotations
import os
from typing import Optional

try:
    from prometheus_client import (
        Counter, Histogram, Gauge, start_http_server,
    )
    _PROM = True
except Exception:                       # pragma: no cover - degrade gracefully
    _PROM = False

    class _Noop:
        def labels(self, *a, **k): return self
        def inc(self, *a, **k):    pass
        def observe(self, *a, **k): pass
        def set(self, *a, **k):    pass

    def Counter(*a, **k):   return _Noop()      # type: ignore
    def Histogram(*a, **k): return _Noop()      # type: ignore
    def Gauge(*a, **k):     return _Noop()      # type: ignore
    def start_http_server(*a, **k): pass        # type: ignore


# ─── Pipeline counters ──────────────────────────────────────────────────
JOBS_CLAIMED = Counter(
    'algosphere_copy_jobs_claimed_total', 'Copy jobs claimed by executors',
    ['worker'])
JOBS_COMPLETED = Counter(
    'algosphere_copy_jobs_completed_total', 'Copy jobs reaching a terminal state',
    ['worker', 'status'])             # status: filled|partial|rejected|skipped|failed
FANOUT_JOBS = Counter(
    'algosphere_copy_fanout_jobs_total', 'copy_jobs created by the orchestrator',
    ['worker'])
RETRIES = Counter(
    'algosphere_copy_retries_total', 'Job re-queues due to transient failure',
    ['worker', 'category'])
DLQ = Counter(
    'algosphere_copy_dlq_total', 'Jobs dead-lettered', ['worker', 'category'])
RECON_FLAGGED = Counter(
    'algosphere_copy_recon_flagged_total', 'Reconciliation discrepancies written',
    ['worker', 'kind'])

# ─── Latency histograms ─────────────────────────────────────────────────
# Buckets tuned for trading: sub-second is the happy path, multi-second is
# a broker/engine problem worth alerting on.
_LAT_BUCKETS = (0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0, 30.0)
JOB_DURATION = Histogram(
    'algosphere_copy_job_duration_seconds', 'End-to-end job processing time',
    ['worker'], buckets=_LAT_BUCKETS)
EXEC_LATENCY = Histogram(
    'algosphere_copy_exec_latency_seconds', 'Engine /execute round-trip',
    ['worker', 'broker'], buckets=_LAT_BUCKETS)

# ─── Gauges ─────────────────────────────────────────────────────────────
QUEUE_DEPTH = Gauge(
    'algosphere_copy_queue_depth', 'Queued copy_jobs awaiting a worker')
WORKER_UP = Gauge(
    'algosphere_copy_worker_up', 'Worker liveness (1=up)', ['worker', 'service'])
# Copy-health aggregates (set by the reconciler after recompute_copy_health).
COPY_HEALTH_AVG = Gauge(
    'algosphere_copy_health_score_avg', 'Mean copy-health score across active subscriptions')
COPY_HEALTH_SUBS = Gauge(
    'algosphere_copy_health_subscriptions', 'Scored subscriptions by health label', ['label'])
COPY_LAG_P95_AVG = Gauge(
    'algosphere_copy_follower_lag_p95_ms_avg', 'Mean of per-subscription p95 signal→fill lag (ms)')


def start_metrics_server(service: str, worker: str,
                         port: Optional[int] = None) -> None:
    p = port or int(os.environ.get('METRICS_PORT', '0') or 0)
    if not _PROM:
        return
    if p <= 0:
        return                          # metrics disabled (no port configured)
    start_http_server(p)
    WORKER_UP.labels(worker=worker, service=service).set(1)


def prometheus_available() -> bool:
    return _PROM
