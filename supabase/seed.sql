-- =============================================================================
-- Dev seed data — run after migrations
-- =============================================================================

-- Sample signals (no auth dependency)
insert into public.signals (pair, direction, entry_price, stop_loss, take_profit_1, take_profit_2, risk_reward, tier_required, status)
values
  ('XAUUSD', 'buy',  2320.50, 2305.00, 2345.00, 2365.00, 1.6, 'starter', 'active'),
  ('EURUSD', 'sell', 1.0850,  1.0900,  1.0780,  1.0740,  1.4, 'starter', 'active'),
  ('GBPUSD', 'buy',  1.2700,  1.2650,  1.2800,  1.2850,  2.0, 'premium', 'active'),
  ('XAUUSD', 'sell', 2380.00, 2400.00, 2340.00, 2310.00, 2.0, 'starter', 'closed');
