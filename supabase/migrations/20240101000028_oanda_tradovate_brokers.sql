-- ============================================================
-- Add OANDA + Tradovate to the broker CHECK constraint
-- Migration: 20240101000028_oanda_tradovate_brokers.sql
--
-- Both are pure-REST cloud adapters (no desktop gateway needed).
--   OANDA     — forex / metals / CFD (REST v20)
--   Tradovate — futures (REST + token auth)
-- ============================================================

ALTER TABLE public.broker_connections
  DROP CONSTRAINT IF EXISTS broker_connections_broker_check;

ALTER TABLE public.broker_connections
  ADD CONSTRAINT broker_connections_broker_check
    CHECK (broker IN (
      'binance',
      'bybit',
      'okx',
      'mt5',
      'ctrader',
      'paper',
      'oanda',
      'tradovate'
    ));
