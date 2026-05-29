-- 20240101000054_user_strategies.sql
--
-- Refocus R5b: user-authored strategy configurations + versioning.
--
-- Distinct from `strategy_registry` (engine's fixed strategies) and
-- `published_strategies` (retired in R7). This is purely about user
-- composition — the AI quant builder.
--
-- Design notes
-- ------------
-- One row in `user_strategies` per logical strategy (named, owned).
-- Append-only rows in `user_strategy_versions` per saved iteration —
-- editing a strategy creates a new version, never mutates an old one.
-- The current version is referenced by `user_strategies.head_version_id`,
-- which the UI uses to load the active config without a join.
--
-- Snapshots are jsonb so the block schema can evolve without a
-- migration per change. The application code in lib/strategies enforces
-- the validation contract; the DB stays permissive.

CREATE TABLE IF NOT EXISTS public.user_strategies (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  name             text NOT NULL,
  description      text,
  template_key     text,                            -- references a template; null when blank-authored
  is_archived      boolean NOT NULL DEFAULT false,
  -- The latest version that the editor loads. Updated whenever the
  -- user saves a new version. NULL only briefly between row create
  -- and first save.
  head_version_id  uuid,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_strategies_user
  ON public.user_strategies (user_id, updated_at DESC)
  WHERE is_archived = false;


CREATE TABLE IF NOT EXISTS public.user_strategy_versions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  strategy_id     uuid NOT NULL REFERENCES public.user_strategies(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  -- 1-indexed per strategy. Computed app-side from MAX(version_number) + 1.
  version_number  integer NOT NULL,
  -- The full strategy snapshot: { blocks: [...], meta: {...} }.
  -- Schema enforced by lib/strategies; the DB only enforces shape via NOT NULL.
  config          jsonb   NOT NULL,
  -- Optional change note set by the user when saving.
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (strategy_id, version_number)
);

CREATE INDEX IF NOT EXISTS idx_user_strategy_versions_strategy
  ON public.user_strategy_versions (strategy_id, version_number DESC);


-- ── FK from head_version_id to user_strategy_versions ────────────
-- Added separately because user_strategy_versions is created above.
DO $$ BEGIN
  ALTER TABLE public.user_strategies
    ADD CONSTRAINT user_strategies_head_fk
    FOREIGN KEY (head_version_id)
    REFERENCES public.user_strategy_versions(id)
    ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;


-- ── updated_at trigger ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_user_strategies_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS user_strategies_updated_at ON public.user_strategies;
CREATE TRIGGER user_strategies_updated_at
  BEFORE UPDATE ON public.user_strategies
  FOR EACH ROW EXECUTE FUNCTION public.set_user_strategies_updated_at();


-- ── RLS ──────────────────────────────────────────────────────────
ALTER TABLE public.user_strategies         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_strategy_versions  ENABLE ROW LEVEL SECURITY;

-- Idempotent: drop+create so re-runs are safe.
DROP POLICY IF EXISTS user_strategies_self_all       ON public.user_strategies;
DROP POLICY IF EXISTS user_strategy_versions_self_select ON public.user_strategy_versions;
DROP POLICY IF EXISTS user_strategy_versions_self_insert ON public.user_strategy_versions;

CREATE POLICY user_strategies_self_all
  ON public.user_strategies FOR ALL
  USING      (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Versions are insert-by-self, read-by-self, never updated or deleted
-- directly. Strategy deletion CASCADEs to versions.
CREATE POLICY user_strategy_versions_self_select
  ON public.user_strategy_versions FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY user_strategy_versions_self_insert
  ON public.user_strategy_versions FOR INSERT
  WITH CHECK (auth.uid() = user_id);


COMMENT ON TABLE public.user_strategies IS
  'Refocus R5b — user-authored quant strategies. One row per named strategy; current config lives in the version referenced by head_version_id.';
COMMENT ON TABLE public.user_strategy_versions IS
  'Refocus R5b — append-only history. Every save creates a new row; the user can roll back by repointing user_strategies.head_version_id.';
