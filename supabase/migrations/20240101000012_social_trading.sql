-- ============================================================
-- AlgoSphere Quant — Social Trading Ecosystem
-- Migration: 20240101000012_social_trading.sql
-- Tables: 16 new tables covering verification, scoring,
--   copy trading, revenue, social feed, community
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- A. TRADER VERIFICATION
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.trader_verifications (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              UUID NOT NULL UNIQUE REFERENCES public.profiles(id) ON DELETE CASCADE,
  tier                 TEXT NOT NULL DEFAULT 'none'
                         CHECK (tier IN ('none','basic','verified','elite')),
  -- Basic (auto)
  basic_unlocked_at    TIMESTAMPTZ,
  basic_trade_count    INTEGER DEFAULT 0,
  basic_days_active    INTEGER DEFAULT 0,
  -- Verified (admin-reviewed)
  verified_at          TIMESTAMPTZ,
  verified_by          UUID REFERENCES public.profiles(id),
  broker_name          TEXT,
  broker_statement_url TEXT,
  live_track_days      INTEGER DEFAULT 0,
  live_win_rate        NUMERIC(5,2),
  live_trade_count     INTEGER DEFAULT 0,
  mt5_account_verified BOOLEAN DEFAULT FALSE,
  mt5_account_id       TEXT,
  -- Elite (committee)
  elite_at             TIMESTAMPTZ,
  elite_sharpe         NUMERIC(8,4),
  elite_months_live    INTEGER DEFAULT 0,
  elite_review_notes   TEXT,
  -- Rejection
  rejected_at          TIMESTAMPTZ,
  rejection_reason     TEXT,
  -- State machine
  application_status   TEXT NOT NULL DEFAULT 'idle'
                         CHECK (application_status IN (
                           'idle','pending_basic','pending_verified','pending_elite','rejected'
                         )),
  applied_at           TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.trader_verifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_read_own_verification"
  ON public.trader_verifications FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "users_insert_own_verification"
  ON public.trader_verifications FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "users_update_own_verification"
  ON public.trader_verifications FOR UPDATE
  USING (auth.uid() = user_id);

-- ────────────────────────────────────────────────────────────
-- B. TRADER SCORES (composite 9-factor score)
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.trader_scores (
  user_id               UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  composite_score       NUMERIC(10,4) NOT NULL DEFAULT 500,
  composite_rank        INTEGER,
  rank_change_24h       INTEGER DEFAULT 0,
  -- 9 component scores (0-100 each)
  score_win_rate        NUMERIC(5,2) DEFAULT 0,
  score_risk_adj        NUMERIC(5,2) DEFAULT 0,
  score_consistency     NUMERIC(5,2) DEFAULT 0,
  score_drawdown        NUMERIC(5,2) DEFAULT 0,
  score_sample_size     NUMERIC(5,2) DEFAULT 0,
  score_recency         NUMERIC(5,2) DEFAULT 0,
  score_diversity       NUMERIC(5,2) DEFAULT 0,
  score_follower_pnl    NUMERIC(5,2) DEFAULT 0,
  score_verification    NUMERIC(5,2) DEFAULT 0,
  -- Cached performance metrics
  win_rate              NUMERIC(5,2),
  sharpe_ratio          NUMERIC(8,4),
  sortino_ratio         NUMERIC(8,4),
  max_drawdown_pct      NUMERIC(8,4),
  profit_factor         NUMERIC(8,4),
  total_trades          INTEGER DEFAULT 0,
  monthly_return_pct    NUMERIC(10,4),
  all_time_return_pct   NUMERIC(10,4),
  -- Social metrics
  followers_count       INTEGER DEFAULT 0,
  following_count       INTEGER DEFAULT 0,
  copy_followers_count  INTEGER DEFAULT 0,
  total_aum_usd         NUMERIC(20,2) DEFAULT 0,
  avg_follower_return   NUMERIC(10,4),
  -- Risk
  risk_score            INTEGER DEFAULT 50 CHECK (risk_score BETWEEN 0 AND 100),
  risk_label            TEXT DEFAULT 'medium' CHECK (risk_label IN ('low','medium','high','extreme')),
  risk_updated_at       TIMESTAMPTZ,
  lookback_days         INTEGER DEFAULT 90,
  computed_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_trader_scores_rank
  ON public.trader_scores (composite_rank ASC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_trader_scores_composite
  ON public.trader_scores (composite_score DESC);

ALTER TABLE public.trader_scores ENABLE ROW LEVEL SECURITY;
CREATE POLICY "scores_readable_by_all"
  ON public.trader_scores FOR SELECT USING (TRUE);
CREATE POLICY "scores_system_write"
  ON public.trader_scores FOR ALL USING (auth.role() = 'service_role');

-- ────────────────────────────────────────────────────────────
-- C. PUBLISHED STRATEGIES
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.published_strategies (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id            UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  name                  TEXT NOT NULL,
  slug                  TEXT NOT NULL UNIQUE,
  tagline               TEXT CHECK (char_length(tagline) <= 120),
  description           TEXT CHECK (char_length(description) <= 2000),
  cover_image_url       TEXT,
  -- Spec
  asset_classes         TEXT[] NOT NULL DEFAULT '{forex}',
  pairs                 TEXT[],
  timeframes            TEXT[] DEFAULT '{H4}',
  trading_style         TEXT CHECK (trading_style IN ('scalping','day','swing','position')),
  risk_approach         TEXT CHECK (risk_approach IN ('conservative','moderate','aggressive')),
  -- Live performance (computed by scoring engine)
  win_rate              NUMERIC(5,2),
  avg_rr                NUMERIC(5,2),
  monthly_return_avg    NUMERIC(10,4),
  max_drawdown          NUMERIC(10,4),
  sharpe_ratio          NUMERIC(10,4),
  total_signals         INTEGER DEFAULT 0,
  days_live             INTEGER DEFAULT 0,
  -- Monetization
  is_free               BOOLEAN NOT NULL DEFAULT FALSE,
  price_monthly         NUMERIC(10,2) CHECK (price_monthly > 0),
  price_annual          NUMERIC(10,2) CHECK (price_annual > 0),
  price_lifetime        NUMERIC(10,2) CHECK (price_lifetime > 0),
  creator_revenue_pct   NUMERIC(5,2) NOT NULL DEFAULT 70.0,
  platform_fee_pct      NUMERIC(5,2) NOT NULL DEFAULT 30.0,
  -- Copy config
  copy_enabled          BOOLEAN NOT NULL DEFAULT FALSE,
  copy_mode             TEXT NOT NULL DEFAULT 'signal_only'
                          CHECK (copy_mode IN ('signal_only','semi_auto','full_auto')),
  profit_share_pct      NUMERIC(5,2) DEFAULT 20.0,
  min_copy_capital      NUMERIC(10,2) DEFAULT 500,
  -- Verification
  verified              BOOLEAN NOT NULL DEFAULT FALSE,
  verified_at           TIMESTAMPTZ,
  verification_level    TEXT NOT NULL DEFAULT 'none'
                          CHECK (verification_level IN ('none','backtested','live_30d','live_90d','live_180d')),
  -- Status
  status                TEXT NOT NULL DEFAULT 'draft'
                          CHECK (status IN ('draft','pending_review','active','suspended','archived')),
  published_at          TIMESTAMPTZ,
  suspended_reason      TEXT,
  -- Stats
  subscribers_count     INTEGER DEFAULT 0,
  copy_followers_count  INTEGER DEFAULT 0,
  total_revenue_usd     NUMERIC(20,2) DEFAULT 0,
  rating_avg            NUMERIC(3,1),
  rating_count          INTEGER DEFAULT 0,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pub_strategies_creator
  ON public.published_strategies (creator_id, status);
CREATE INDEX IF NOT EXISTS idx_pub_strategies_active
  ON public.published_strategies (status, subscribers_count DESC)
  WHERE status = 'active';

ALTER TABLE public.published_strategies ENABLE ROW LEVEL SECURITY;
CREATE POLICY "active_strategies_public"
  ON public.published_strategies FOR SELECT
  USING (status = 'active' OR creator_id = auth.uid());
CREATE POLICY "creators_manage_own"
  ON public.published_strategies FOR ALL
  USING (creator_id = auth.uid());

-- Strategy reviews
CREATE TABLE IF NOT EXISTS public.strategy_reviews (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  strategy_id       UUID NOT NULL REFERENCES public.published_strategies(id) ON DELETE CASCADE,
  reviewer_id       UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  rating            INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  title             TEXT CHECK (char_length(title) <= 100),
  body              TEXT CHECK (char_length(body) <= 1000),
  is_verified_sub   BOOLEAN NOT NULL DEFAULT FALSE,
  helpful_count     INTEGER DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (strategy_id, reviewer_id)
);

ALTER TABLE public.strategy_reviews ENABLE ROW LEVEL SECURITY;
CREATE POLICY "reviews_public_read" ON public.strategy_reviews FOR SELECT USING (TRUE);
CREATE POLICY "reviewers_manage_own"
  ON public.strategy_reviews FOR ALL USING (reviewer_id = auth.uid());

-- ────────────────────────────────────────────────────────────
-- D. FOLLOWER SYSTEM
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.trader_follows (
  follower_id     UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  leader_id       UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  notifications   BOOLEAN NOT NULL DEFAULT TRUE,
  followed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (follower_id, leader_id),
  CHECK (follower_id <> leader_id)
);

CREATE INDEX IF NOT EXISTS idx_trader_follows_leader
  ON public.trader_follows (leader_id);
CREATE INDEX IF NOT EXISTS idx_trader_follows_follower
  ON public.trader_follows (follower_id);

ALTER TABLE public.trader_follows ENABLE ROW LEVEL SECURITY;
CREATE POLICY "follows_users_manage_own"
  ON public.trader_follows FOR ALL USING (follower_id = auth.uid());
CREATE POLICY "follows_leaders_see_followers"
  ON public.trader_follows FOR SELECT USING (leader_id = auth.uid());

-- Strategy subscriptions
CREATE TABLE IF NOT EXISTS public.strategy_subscriptions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subscriber_id   UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  strategy_id     UUID NOT NULL REFERENCES public.published_strategies(id) ON DELETE CASCADE,
  plan            TEXT NOT NULL DEFAULT 'monthly'
                    CHECK (plan IN ('free','monthly','annual','lifetime')),
  amount_paid_usd NUMERIC(10,2) NOT NULL DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active','cancelled','expired','paused')),
  -- Copy config
  copy_enabled    BOOLEAN NOT NULL DEFAULT FALSE,
  copy_mode       TEXT NOT NULL DEFAULT 'signal_only'
                    CHECK (copy_mode IN ('signal_only','semi_auto','full_auto')),
  allocation_pct  NUMERIC(5,2) DEFAULT 5.0,
  risk_multiplier NUMERIC(5,2) DEFAULT 1.0,
  max_lot_size    NUMERIC(20,8),
  copy_sl         BOOLEAN DEFAULT TRUE,
  copy_tp         BOOLEAN DEFAULT TRUE,
  hwm_basis       NUMERIC(20,8) DEFAULT 0,
  started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at      TIMESTAMPTZ,
  cancelled_at    TIMESTAMPTZ,
  cancel_reason   TEXT,
  UNIQUE (subscriber_id, strategy_id)
);

CREATE INDEX IF NOT EXISTS idx_strategy_subs_subscriber
  ON public.strategy_subscriptions (subscriber_id, status);
CREATE INDEX IF NOT EXISTS idx_strategy_subs_strategy
  ON public.strategy_subscriptions (strategy_id, status);

ALTER TABLE public.strategy_subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "subs_users_manage_own"
  ON public.strategy_subscriptions FOR ALL USING (subscriber_id = auth.uid());
CREATE POLICY "subs_creators_see_subscribers"
  ON public.strategy_subscriptions FOR SELECT
  USING (
    strategy_id IN (
      SELECT id FROM public.published_strategies WHERE creator_id = auth.uid()
    )
  );

-- ────────────────────────────────────────────────────────────
-- E. COPY TRADES
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.copy_trades (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id   UUID NOT NULL REFERENCES public.strategy_subscriptions(id) ON DELETE CASCADE,
  leader_id         UUID NOT NULL REFERENCES public.profiles(id),
  follower_id       UUID NOT NULL REFERENCES public.profiles(id),
  signal_id         UUID REFERENCES public.signals(id),
  -- Order details
  symbol            TEXT NOT NULL,
  direction         TEXT NOT NULL CHECK (direction IN ('buy','sell')),
  leader_entry      NUMERIC(20,8),
  follower_entry    NUMERIC(20,8),
  leader_lot        NUMERIC(20,8),
  follower_lot      NUMERIC(20,8),
  scale_factor      NUMERIC(10,4),
  stop_loss         NUMERIC(20,8),
  take_profit       NUMERIC(20,8),
  -- Result
  leader_pnl        NUMERIC(20,8),
  follower_pnl      NUMERIC(20,8),
  follower_pnl_pct  NUMERIC(10,4),
  -- Execution
  copy_mode         TEXT NOT NULL,
  broker            TEXT,
  broker_order_id   TEXT,
  status            TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','mirrored','partial','failed','skipped','closed')),
  skip_reason       TEXT,
  slippage_pct      NUMERIC(10,6),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  opened_at         TIMESTAMPTZ,
  closed_at         TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_copy_trades_follower
  ON public.copy_trades (follower_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_copy_trades_leader
  ON public.copy_trades (leader_id, created_at DESC);

ALTER TABLE public.copy_trades ENABLE ROW LEVEL SECURITY;
CREATE POLICY "copy_trades_users_see_own"
  ON public.copy_trades FOR SELECT
  USING (follower_id = auth.uid() OR leader_id = auth.uid());
CREATE POLICY "copy_trades_system_write"
  ON public.copy_trades FOR ALL USING (auth.role() = 'service_role');

-- ────────────────────────────────────────────────────────────
-- F. REVENUE SHARING
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.creator_earnings (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id        UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  strategy_id       UUID REFERENCES public.published_strategies(id),
  subscriber_id     UUID REFERENCES public.profiles(id),
  earning_type      TEXT NOT NULL
                      CHECK (earning_type IN ('subscription_fee','profit_share','tip')),
  gross_usd         NUMERIC(20,8) NOT NULL,
  platform_fee_pct  NUMERIC(5,2) NOT NULL,
  platform_fee_usd  NUMERIC(20,8) NOT NULL,
  creator_pct       NUMERIC(5,2) NOT NULL,
  creator_usd       NUMERIC(20,8) NOT NULL,
  hwm_basis         NUMERIC(20,8),
  hwm_new           NUMERIC(20,8),
  period_start      DATE,
  period_end        DATE,
  status            TEXT NOT NULL DEFAULT 'accrued'
                      CHECK (status IN ('accrued','approved','paid','disputed','voided')),
  paid_at           TIMESTAMPTZ,
  payout_txid       TEXT,
  payout_wallet     TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_creator_earnings_creator
  ON public.creator_earnings (creator_id, status);

ALTER TABLE public.creator_earnings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "earnings_creators_see_own"
  ON public.creator_earnings FOR SELECT USING (creator_id = auth.uid());
CREATE POLICY "earnings_system_write"
  ON public.creator_earnings FOR ALL USING (auth.role() = 'service_role');

CREATE TABLE IF NOT EXISTS public.creator_payout_requests (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id       UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  amount_usd       NUMERIC(20,8) NOT NULL,
  wallet_address   TEXT NOT NULL,
  network          TEXT NOT NULL DEFAULT 'TRC20',
  earning_ids      UUID[] NOT NULL,
  status           TEXT NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending','approved','processing','paid','rejected')),
  minimum_met      BOOLEAN NOT NULL DEFAULT FALSE,
  txid             TEXT,
  processed_at     TIMESTAMPTZ,
  rejection_reason TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.creator_payout_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "payouts_creators_see_own"
  ON public.creator_payout_requests FOR SELECT USING (creator_id = auth.uid());
CREATE POLICY "payouts_creators_insert"
  ON public.creator_payout_requests FOR INSERT WITH CHECK (creator_id = auth.uid());

-- ────────────────────────────────────────────────────────────
-- G. SOCIAL FEED
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.social_posts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id       UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  post_type       TEXT NOT NULL DEFAULT 'text'
                    CHECK (post_type IN ('text','signal_share','trade_share','market_view','analysis','milestone')),
  body            TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),
  media_urls      TEXT[] DEFAULT '{}',
  signal_id       UUID REFERENCES public.signals(id) ON DELETE SET NULL,
  trade_id        UUID REFERENCES public.journal_entries(id) ON DELETE SET NULL,
  visibility      TEXT NOT NULL DEFAULT 'public'
                    CHECK (visibility IN ('public','followers','subscribers','private')),
  likes_count     INTEGER NOT NULL DEFAULT 0,
  comments_count  INTEGER NOT NULL DEFAULT 0,
  reposts_count   INTEGER NOT NULL DEFAULT 0,
  views_count     INTEGER NOT NULL DEFAULT 0,
  saves_count     INTEGER NOT NULL DEFAULT 0,
  is_pinned       BOOLEAN NOT NULL DEFAULT FALSE,
  is_flagged      BOOLEAN NOT NULL DEFAULT FALSE,
  flagged_reason  TEXT,
  edited_at       TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_social_posts_author
  ON public.social_posts (author_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_social_posts_public_feed
  ON public.social_posts (created_at DESC)
  WHERE visibility = 'public' AND NOT is_flagged;

ALTER TABLE public.social_posts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "posts_public_readable"
  ON public.social_posts FOR SELECT
  USING (
    (visibility = 'public' AND NOT is_flagged)
    OR author_id = auth.uid()
  );
CREATE POLICY "posts_authors_manage_own"
  ON public.social_posts FOR ALL USING (author_id = auth.uid());

CREATE TABLE IF NOT EXISTS public.social_post_reactions (
  post_id     UUID NOT NULL REFERENCES public.social_posts(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  reaction    TEXT NOT NULL DEFAULT 'like'
                CHECK (reaction IN ('like','bullish','bearish','insightful','fire')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (post_id, user_id)
);

ALTER TABLE public.social_post_reactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "reactions_public_read"
  ON public.social_post_reactions FOR SELECT USING (TRUE);
CREATE POLICY "reactions_users_manage_own"
  ON public.social_post_reactions FOR ALL USING (user_id = auth.uid());

CREATE TABLE IF NOT EXISTS public.social_post_saves (
  post_id  UUID NOT NULL REFERENCES public.social_posts(id) ON DELETE CASCADE,
  user_id  UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  saved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (post_id, user_id)
);

ALTER TABLE public.social_post_saves ENABLE ROW LEVEL SECURITY;
CREATE POLICY "saves_users_manage_own"
  ON public.social_post_saves FOR ALL USING (user_id = auth.uid());

-- ────────────────────────────────────────────────────────────
-- H. COMMUNITY DISCUSSIONS
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.discussion_threads (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id     UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  category      TEXT NOT NULL
                  CHECK (category IN (
                    'signals','strategy','risk','psychology',
                    'crypto','defi','general','announcements'
                  )),
  title         TEXT NOT NULL CHECK (char_length(title) BETWEEN 5 AND 200),
  body          TEXT NOT NULL CHECK (char_length(body) BETWEEN 10 AND 5000),
  tags          TEXT[] DEFAULT '{}',
  pinned_by     UUID REFERENCES public.profiles(id),
  is_locked     BOOLEAN NOT NULL DEFAULT FALSE,
  is_resolved   BOOLEAN NOT NULL DEFAULT FALSE,
  views_count   INTEGER NOT NULL DEFAULT 0,
  replies_count INTEGER NOT NULL DEFAULT 0,
  votes_score   INTEGER NOT NULL DEFAULT 0,
  last_reply_at TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_threads_category
  ON public.discussion_threads (category, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_threads_hot
  ON public.discussion_threads (votes_score DESC, created_at DESC);

ALTER TABLE public.discussion_threads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "threads_public_read"
  ON public.discussion_threads FOR SELECT USING (TRUE);
CREATE POLICY "threads_auth_insert"
  ON public.discussion_threads FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "threads_authors_update"
  ON public.discussion_threads FOR UPDATE USING (author_id = auth.uid());

CREATE TABLE IF NOT EXISTS public.discussion_replies (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id       UUID NOT NULL REFERENCES public.discussion_threads(id) ON DELETE CASCADE,
  author_id       UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  parent_reply_id UUID REFERENCES public.discussion_replies(id) ON DELETE CASCADE,
  body            TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),
  votes_score     INTEGER NOT NULL DEFAULT 0,
  is_solution     BOOLEAN NOT NULL DEFAULT FALSE,
  is_flagged      BOOLEAN NOT NULL DEFAULT FALSE,
  edited_at       TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_replies_thread
  ON public.discussion_replies (thread_id, created_at ASC);

ALTER TABLE public.discussion_replies ENABLE ROW LEVEL SECURITY;
CREATE POLICY "replies_public_read"
  ON public.discussion_replies FOR SELECT USING (NOT is_flagged OR author_id = auth.uid());
CREATE POLICY "replies_auth_insert"
  ON public.discussion_replies FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "replies_authors_update"
  ON public.discussion_replies FOR UPDATE USING (author_id = auth.uid());

CREATE TABLE IF NOT EXISTS public.discussion_votes (
  target_type TEXT    NOT NULL CHECK (target_type IN ('thread','reply')),
  target_id   UUID    NOT NULL,
  user_id     UUID    NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  vote        SMALLINT NOT NULL CHECK (vote IN (-1, 1)),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (target_type, target_id, user_id)
);

ALTER TABLE public.discussion_votes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "votes_public_read"   ON public.discussion_votes FOR SELECT USING (TRUE);
CREATE POLICY "votes_users_manage"  ON public.discussion_votes FOR ALL   USING (user_id = auth.uid());

-- ────────────────────────────────────────────────────────────
-- I. SOCIAL NOTIFICATIONS
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.social_notifications (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  actor_id     UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  notif_type   TEXT NOT NULL,
  entity_type  TEXT,
  entity_id    UUID,
  message      TEXT NOT NULL,
  read         BOOLEAN NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_social_notifs_unread
  ON public.social_notifications (recipient_id, read, created_at DESC);

ALTER TABLE public.social_notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "notifs_users_see_own"
  ON public.social_notifications FOR SELECT USING (recipient_id = auth.uid());
CREATE POLICY "notifs_users_mark_read"
  ON public.social_notifications FOR UPDATE USING (recipient_id = auth.uid());
CREATE POLICY "notifs_system_insert"
  ON public.social_notifications FOR INSERT WITH CHECK (auth.role() = 'service_role');

-- ────────────────────────────────────────────────────────────
-- J. HELPER FUNCTIONS
-- ────────────────────────────────────────────────────────────

-- Toggle follow: follow if not following, unfollow if already following
CREATE OR REPLACE FUNCTION public.toggle_follow(p_leader_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_follower UUID := auth.uid();
  v_exists   BOOLEAN;
BEGIN
  IF v_follower IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF v_follower = p_leader_id THEN
    RAISE EXCEPTION 'Cannot follow yourself';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.trader_follows
    WHERE follower_id = v_follower AND leader_id = p_leader_id
  ) INTO v_exists;

  IF v_exists THEN
    DELETE FROM public.trader_follows
    WHERE follower_id = v_follower AND leader_id = p_leader_id;

    UPDATE public.trader_scores
    SET followers_count = GREATEST(0, followers_count - 1)
    WHERE user_id = p_leader_id;

    UPDATE public.trader_scores
    SET following_count = GREATEST(0, following_count - 1)
    WHERE user_id = v_follower;

    RETURN jsonb_build_object('following', FALSE);
  ELSE
    INSERT INTO public.trader_follows (follower_id, leader_id)
    VALUES (v_follower, p_leader_id)
    ON CONFLICT DO NOTHING;

    INSERT INTO public.trader_scores (user_id, followers_count)
    VALUES (p_leader_id, 1)
    ON CONFLICT (user_id) DO UPDATE
      SET followers_count = trader_scores.followers_count + 1;

    INSERT INTO public.trader_scores (user_id, following_count)
    VALUES (v_follower, 1)
    ON CONFLICT (user_id) DO UPDATE
      SET following_count = trader_scores.following_count + 1;

    -- Notification to leader
    INSERT INTO public.social_notifications
      (recipient_id, actor_id, notif_type, message)
    SELECT p_leader_id, v_follower, 'new_follower',
           COALESCE(p.public_handle, 'Someone') || ' started following you'
    FROM   public.profiles p WHERE p.id = v_follower;

    RETURN jsonb_build_object('following', TRUE);
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.toggle_follow TO authenticated;

-- React to a post (toggle)
CREATE OR REPLACE FUNCTION public.react_to_post(
  p_post_id UUID,
  p_reaction TEXT DEFAULT 'like'
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_user   UUID := auth.uid();
  v_exists BOOLEAN;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.social_post_reactions
    WHERE post_id = p_post_id AND user_id = v_user
  ) INTO v_exists;

  IF v_exists THEN
    DELETE FROM public.social_post_reactions
    WHERE post_id = p_post_id AND user_id = v_user;

    UPDATE public.social_posts
    SET likes_count = GREATEST(0, likes_count - 1)
    WHERE id = p_post_id;

    RETURN jsonb_build_object('reacted', FALSE);
  ELSE
    INSERT INTO public.social_post_reactions (post_id, user_id, reaction)
    VALUES (p_post_id, v_user, p_reaction)
    ON CONFLICT (post_id, user_id) DO UPDATE SET reaction = EXCLUDED.reaction;

    UPDATE public.social_posts
    SET likes_count = likes_count + 1
    WHERE id = p_post_id;

    RETURN jsonb_build_object('reacted', TRUE, 'reaction', p_reaction);
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.react_to_post TO authenticated;

-- Leaderboard v2 — uses trader_scores table (populated by social engine)
CREATE OR REPLACE FUNCTION public.trader_leaderboard_v2(
  p_category    TEXT    DEFAULT 'overall',
  p_limit       INTEGER DEFAULT 50,
  p_offset      INTEGER DEFAULT 0
)
RETURNS TABLE (
  user_id          UUID,
  handle           TEXT,
  bio              TEXT,
  composite_score  NUMERIC,
  composite_rank   INTEGER,
  rank_change_24h  INTEGER,
  win_rate         NUMERIC,
  monthly_return   NUMERIC,
  total_trades     INTEGER,
  sharpe_ratio     NUMERIC,
  max_drawdown     NUMERIC,
  followers_count  INTEGER,
  risk_label       TEXT,
  risk_score       INTEGER,
  verification_tier TEXT
)
LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT
    ts.user_id,
    p.public_handle   AS handle,
    p.bio,
    ts.composite_score,
    ts.composite_rank,
    ts.rank_change_24h,
    ts.win_rate,
    ts.monthly_return_pct  AS monthly_return,
    ts.total_trades,
    ts.sharpe_ratio,
    ts.max_drawdown_pct    AS max_drawdown,
    ts.followers_count,
    ts.risk_label,
    ts.risk_score,
    COALESCE(tv.tier, 'none') AS verification_tier
  FROM   public.trader_scores ts
  JOIN   public.profiles p
         ON p.id = ts.user_id AND p.public_profile = TRUE
  LEFT JOIN public.trader_verifications tv ON tv.user_id = ts.user_id
  WHERE  ts.total_trades >= 5
  ORDER  BY ts.composite_score DESC
  LIMIT  p_limit
  OFFSET p_offset;
$$;

GRANT EXECUTE ON FUNCTION public.trader_leaderboard_v2 TO anon, authenticated;

-- Check if current user follows a trader
CREATE OR REPLACE FUNCTION public.is_following(p_leader_id UUID)
RETURNS BOOLEAN
LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.trader_follows
    WHERE follower_id = auth.uid() AND leader_id = p_leader_id
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_following TO authenticated;

-- Get follower count for a trader
CREATE OR REPLACE FUNCTION public.get_follower_count(p_user_id UUID)
RETURNS INTEGER
LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT COUNT(*)::INTEGER FROM public.trader_follows WHERE leader_id = p_user_id;
$$;

GRANT EXECUTE ON FUNCTION public.get_follower_count TO anon, authenticated;
