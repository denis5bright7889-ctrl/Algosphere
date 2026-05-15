"""
AlgoSphere Signal Engine — FastAPI Application
Entry point: starts APScheduler, mounts WebSocket channels, exposes REST API.
"""
from __future__ import annotations
import asyncio
import os
import uuid
from contextlib import asynccontextmanager
from typing import Optional

from fastapi import FastAPI, WebSocket, Query
from fastapi.middleware.cors import CORSMiddleware
from loguru import logger

from config import get_settings
from websocket.manager import ws_manager
from api.routes import router as api_router
from worker.signal_worker import SignalWorker
from worker.lifecycle_monitor import LifecycleMonitor
from observability import configure_logging, RequestLoggingMiddleware, RateLimitMiddleware


# ─── APScheduler ─────────────────────────────────────────────────────────────

def _build_scheduler(worker: SignalWorker, monitor: LifecycleMonitor):
    from apscheduler.schedulers.asyncio import AsyncIOScheduler

    settings = get_settings()
    scheduler = AsyncIOScheduler(timezone='UTC')

    scheduler.add_job(
        worker.scan_all,
        trigger='interval',
        minutes=settings.scan_interval_minutes,
        id='scan_all',
        max_instances=1,
        coalesce=True,
        misfire_grace_time=60,
    )

    # Lifecycle monitor: check every 2 minutes
    scheduler.add_job(
        monitor.check_all,
        trigger='interval',
        minutes=2,
        id='lifecycle_check',
        max_instances=1,
        coalesce=True,
        misfire_grace_time=30,
    )

    # Confidence calibration analytics — runs every 6 hours
    scheduler.add_job(
        _run_calibration,
        trigger='interval',
        hours=6,
        id='calibration',
        max_instances=1,
        coalesce=True,
    )

    # Daily circuit-breaker reset at midnight UTC
    scheduler.add_job(
        _daily_reset,
        trigger='cron',
        hour=0,
        minute=0,
        id='daily_reset',
        args=[worker],
    )

    return scheduler


async def _run_calibration() -> None:
    from config import get_settings
    from supabase import create_client
    from analytics.engine import compute_calibration, save_analytics_snapshot
    s = get_settings()
    db = create_client(s.supabase_url, s.supabase_service_role_key)
    report = await compute_calibration(db)
    if report:
        await save_analytics_snapshot(db, report)
        logger.info(
            f"Calibration: win_rate={report.overall_win_rate:.1%} "
            f"error={report.calibration_error:.3f} n={report.total_signals}"
        )


async def _daily_reset(worker: SignalWorker) -> None:
    settings = get_settings()
    for sym in settings.symbol_list:
        worker._risk_engine.reset_daily(sym)
    logger.info("Daily circuit-breaker counters reset")


# ─── App lifespan ─────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    logger.info(f"Starting AlgoSphere Signal Engine — symbols: {settings.symbol_list}")

    # Build worker and register globally
    worker_instance = SignalWorker()
    from worker.registry import set_worker
    set_worker(worker_instance)

    # Inject WebSocket broadcaster
    async def _ws_broadcast(symbol: str, signal_id: str, tier_required: str) -> None:
        n = await ws_manager.broadcast_signal(symbol, signal_id, tier_required)
        logger.debug(f"[{symbol}] WS broadcast → {n} client(s)")

    worker_instance.set_ws_broadcaster(_ws_broadcast)

    # Build lifecycle monitor (shares the same provider)
    monitor = LifecycleMonitor(provider=worker_instance.provider())

    # Start WebSocket manager
    await ws_manager.start()

    # Start scheduler
    scheduler = _build_scheduler(worker_instance, monitor)
    scheduler.start()
    logger.info(f"Scheduler started — scan every {settings.scan_interval_minutes}m")

    # Run an initial scan on startup (non-blocking)
    asyncio.create_task(worker_instance.scan_all())

    yield

    # Shutdown
    scheduler.shutdown(wait=False)
    await ws_manager.stop()
    logger.info("Signal engine shut down")


# ─── App factory ─────────────────────────────────────────────────────────────

def create_app() -> FastAPI:
    settings = get_settings()

    configure_logging(settings.environment)

    app = FastAPI(
        title='AlgoSphere Signal Engine',
        version='1.0.0',
        docs_url='/docs' if os.getenv('ENV', 'production') != 'production' else None,
        redoc_url=None,
        lifespan=lifespan,
    )

    allowed_origins = [o.strip() for o in settings.allowed_origins.split(',') if o.strip()]

    app.add_middleware(RateLimitMiddleware, max_requests=120, window_seconds=60)
    app.add_middleware(RequestLoggingMiddleware)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=allowed_origins,
        allow_credentials=True,
        allow_methods=['GET', 'POST'],
        allow_headers=['*'],
    )

    app.include_router(api_router, prefix='/api/v1')

    # ─── WebSocket endpoints ──────────────────────────────────────────────────

    @app.websocket('/ws/signals')
    async def ws_signals(
        websocket: WebSocket,
        tier: str = Query(default='free'),
        client_id: Optional[str] = Query(default=None),
    ):
        """Real-time signal broadcast. Filtered by tier and optional symbol subscriptions."""
        cid = client_id or str(uuid.uuid4())
        # Clamp tier to valid values
        if tier not in ('free', 'starter', 'premium'):
            tier = 'free'
        conn = await ws_manager.connect(websocket, cid, tier)
        await ws_manager.handle(conn)

    @app.websocket('/ws/regime')
    async def ws_regime(
        websocket: WebSocket,
        client_id: Optional[str] = Query(default=None),
    ):
        """Real-time regime classification updates (all tiers)."""
        cid = client_id or str(uuid.uuid4())
        conn = await ws_manager.connect(websocket, cid, 'free')
        await ws_manager.handle(conn)

    @app.websocket('/ws/analytics')
    async def ws_analytics(
        websocket: WebSocket,
        tier: str = Query(default='free'),
        client_id: Optional[str] = Query(default=None),
    ):
        """Premium analytics stream."""
        cid = client_id or str(uuid.uuid4())
        if tier not in ('free', 'starter', 'premium'):
            tier = 'free'
        conn = await ws_manager.connect(websocket, cid, tier)
        await ws_manager.handle(conn)

    return app


app = create_app()


# ─── Dev entry point ─────────────────────────────────────────────────────────

if __name__ == '__main__':
    import uvicorn
    settings = get_settings()
    uvicorn.run(
        'main:app',
        host='0.0.0.0',
        port=int(os.getenv('PORT', '8001')),
        reload=os.getenv('ENV') == 'development',
        log_level='info',
    )
