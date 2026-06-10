-- 20240101000077_growth_trade_breakdown_rule.sql
--
-- Phase 2 of the Growth Content Expansion — Trade Breakdown rule.
--
-- Wires the existing trade_recap_video + trade_result_card asset
-- producers (already registered on the Railway asset-worker) to a
-- new trade.closed event + the generateTradeBreakdown content
-- generator (shipped in lib/growth/generators.ts).
--
-- Privacy-first design: output_status='draft' so the operator
-- approves every trade before it publishes. Broker-detected user
-- trades (source='auto_human') and engine-executed trades
-- (source='auto_engine') BOTH flow through this rule, but neither
-- auto-publishes — admin gate prevents leaking personal trade data
-- without explicit approval.
--
-- Daily-mix orchestrator (lib/growth/daily-mix.ts) picks the best
-- recent closed trade (highest coach quality_score from the past 24h)
-- and fires trade.closed with the full payload.
--
-- Idempotent via uq_automation_rules_name unique index.

INSERT INTO public.growth_automation_rules
  (name, description, event_type, predicate, content_kind, channels,
   output_status, daily_cap, asset_kinds)
VALUES
  ('trade.closed → Trade Breakdown draft',
   'When a journal entry closes with complete trade data, draft a Trade Breakdown with the recap card + recap video. Admin approves per-trade (privacy gate) — broker-detected user trades and engine-executed trades both flow through but neither auto-publishes.',
   'trade.closed',
   '{}'::jsonb,
   'trade_breakdown',
   ARRAY['discord','telegram','linkedin'],
   'draft',
   3,
   ARRAY['trade_result_card','trade_recap_video'])
ON CONFLICT (name) DO NOTHING;
