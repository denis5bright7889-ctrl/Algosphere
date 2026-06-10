-- 20240101000075_enable_rls_all_public.sql
--
-- SECURITY FIX (Supabase advisor: rls_disabled_in_public).
-- Any public-schema table without RLS is readable/writable by anyone with the
-- anon key. CLAUDE.md mandates RLS on ALL tables. This migration finds every
-- public table with RLS disabled, RAISE NOTICEs it (so the operator sees which
-- were exposed), enables RLS, and grants service-role full access so all
-- server-side workers (engine, asset-worker, web API routes) keep working.
-- anon/authenticated are denied by default — any table that genuinely needs
-- client reads gets an explicit read policy in a follow-up migration.
-- Idempotent: only touches tables whose RLS is currently OFF.

DO $$
DECLARE
  r record;
  fixed text[] := '{}';
BEGIN
  FOR r IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'                 -- ordinary tables only
      AND c.relrowsecurity = false
    ORDER BY c.relname
  LOOP
    RAISE NOTICE 'rls_fix: enabling RLS on public.% (was exposed)', r.relname;
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', r.relname);
    EXECUTE format($f$
      DROP POLICY IF EXISTS "%1$s_service_all" ON public.%1$s;
      CREATE POLICY "%1$s_service_all" ON public.%1$s FOR ALL
        USING (auth.role() = 'service_role')
        WITH CHECK (auth.role() = 'service_role');
    $f$, r.relname);
    fixed := array_append(fixed, r.relname);
  END LOOP;

  IF array_length(fixed, 1) IS NULL THEN
    RAISE NOTICE 'rls_fix: no public tables had RLS disabled — nothing to do';
  ELSE
    RAISE NOTICE 'rls_fix: secured % table(s): %', array_length(fixed, 1), array_to_string(fixed, ', ');
  END IF;
END $$;
