/**
 * /api/admin/growth/diagnostics — environment audit.
 *
 * Reports set / not-set per integration env var so the operator can
 * verify Vercel is configured without re-pasting the secret value.
 * Values are NEVER returned — only booleans + character-count hints
 * (e.g. `>= 32 chars`) so a typo / truncation can be caught.
 *
 * Admin-only.
 */
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isAdmin } from '@/lib/admin'

export const dynamic = 'force-dynamic'

interface EnvCheck {
  key:     string
  set:     boolean
  /** Optional notes — char count, prefix sanity-check, etc. NEVER the value. */
  hint?:   string
  /** Which integration this env powers. */
  group:   string
}

function check(key: string, group: string, opts?: { minLen?: number; prefix?: string; allowEmpty?: boolean }): EnvCheck {
  const raw = process.env[key]
  const v = (raw ?? '').trim()
  if (!v) return { key, group, set: false }

  const notes: string[] = [`${v.length} chars`]
  if (opts?.minLen && v.length < opts.minLen) {
    notes.push(`⚠ shorter than expected (>=${opts.minLen})`)
  }
  if (opts?.prefix && !v.startsWith(opts.prefix)) {
    notes.push(`⚠ does not start with "${opts.prefix}"`)
  }
  return { key, group, set: true, hint: notes.join(' · ') }
}

async function gate() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  if (!isAdmin(user.email)) return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  return { user }
}

export async function GET() {
  const g = await gate()
  if ('error' in g) return g.error

  const checks: EnvCheck[] = [
    // ── Core
    check('NEXT_PUBLIC_APP_URL',         'core'),
    check('CRON_SECRET',                 'core', { minLen: 16 }),
    check('SUPABASE_SERVICE_ROLE_KEY',   'core', { minLen: 100 }),
    check('NEXT_PUBLIC_SUPABASE_URL',    'core'),
    check('NEXT_PUBLIC_SUPABASE_ANON_KEY','core'),

    // ── Email
    check('RESEND_API_KEY',  'email', { prefix: 're_' }),
    check('RESEND_FROM',     'email'),

    // ── Telegram (Growth)
    check('TELEGRAM_BOT_TOKEN',          'telegram', { minLen: 40 }),
    check('GROWTH_TELEGRAM_CHANNEL_ID',  'telegram'),

    // ── Discord — Growth Engine subset
    check('DISCORD_WEBHOOK_GENERAL_URL',         'discord_growth', { prefix: 'https://discord.com/api/webhooks/' }),
    check('DISCORD_WEBHOOK_ANNOUNCEMENTS_URL',   'discord_growth', { prefix: 'https://discord.com/api/webhooks/' }),
    check('DISCORD_WEBHOOK_MARKET_INTEL_URL',    'discord_growth', { prefix: 'https://discord.com/api/webhooks/' }),
    check('DISCORD_WEBHOOK_ALGO_UPDATES_URL',    'discord_growth', { prefix: 'https://discord.com/api/webhooks/' }),
    check('DISCORD_WEBHOOK_EDUCATION_URL',       'discord_growth', { prefix: 'https://discord.com/api/webhooks/' }),

    // ── Discord — Ops / user channels
    check('DISCORD_WEBHOOK_HEALTH_URL',          'discord_ops', { prefix: 'https://discord.com/api/webhooks/' }),
    check('DISCORD_WEBHOOK_ADMIN_URL',           'discord_ops', { prefix: 'https://discord.com/api/webhooks/' }),
    check('DISCORD_WEBHOOK_SUPPORT_URL',         'discord_ops', { prefix: 'https://discord.com/api/webhooks/' }),
    check('DISCORD_WEBHOOK_BUG_REPORTS_URL',     'discord_ops', { prefix: 'https://discord.com/api/webhooks/' }),

    // ── Discord — Engine (Railway-side) — these are read on Vercel
    //    too for completeness, but the signal engine reads them from
    //    its own Railway env. "not set" here is only a problem if the
    //    web app needs to mirror posts.
    check('DISCORD_WEBHOOK_SIGNALS_FREE_URL',         'discord_engine', { prefix: 'https://discord.com/api/webhooks/' }),
    check('DISCORD_WEBHOOK_SIGNALS_PREMIUM_URL',      'discord_engine', { prefix: 'https://discord.com/api/webhooks/' }),
    check('DISCORD_WEBHOOK_SIGNALS_WHALES_URL',       'discord_engine', { prefix: 'https://discord.com/api/webhooks/' }),
    check('DISCORD_WEBHOOK_TRADES_URL',               'discord_engine', { prefix: 'https://discord.com/api/webhooks/' }),
    check('DISCORD_WEBHOOK_REJECTIONS_TRANSPARENCY_URL','discord_engine', { prefix: 'https://discord.com/api/webhooks/' }),

    // ── Meta (Facebook + Instagram)
    check('META_PAGE_ACCESS_TOKEN',  'meta', { minLen: 80 }),
    check('META_FB_PAGE_ID',         'meta'),
    check('META_IG_USER_ID',         'meta'),

    // ── LinkedIn
    check('LINKEDIN_ACCESS_TOKEN', 'linkedin', { minLen: 40 }),
    check('LINKEDIN_AUTHOR_URN',   'linkedin', { prefix: 'urn:li:' }),

    // ── X (Twitter)
    check('X_API_KEY',             'x'),
    check('X_API_SECRET',          'x'),
    check('X_ACCESS_TOKEN',        'x'),
    check('X_ACCESS_TOKEN_SECRET', 'x'),
  ]

  const summary = {
    total:        checks.length,
    set:          checks.filter((c) => c.set).length,
    by_group:     {} as Record<string, { total: number; set: number }>,
  }
  for (const c of checks) {
    if (!summary.by_group[c.group]) summary.by_group[c.group] = { total: 0, set: 0 }
    summary.by_group[c.group]!.total += 1
    if (c.set) summary.by_group[c.group]!.set += 1
  }

  // Live introspection of the Meta token's lifetime + scopes via the
  // /debug_token endpoint. Catches the trap that hit production on
  // 2026-06-02: a short-lived user token (~12h) was loaded into Vercel,
  // smoke-tested green at deploy, then silently expired by morning.
  //
  // We never log or return the token itself — only its computed
  // expires_in_s, scopes list, and type so the operator sees
  // "META: expires in 2 days · type=USER" and rotates BEFORE breakage.
  const meta = await metaTokenIntrospect()

  // Catch the common Vercel-env-key typos the operator hit. Cheap:
  // walk process.env for substring-matches of correct-key root with
  // a wrong separator (BUGREPORTS vs BUG_REPORTS, FACEBOOK vs PAGE,
  // TELEGRAM_ID vs GROWTH_TELEGRAM_CHANNEL_ID).
  const misnamed = detectMisnamedEnvKeys()

  return NextResponse.json({
    checked_at: new Date().toISOString(),
    summary,
    checks,
    meta_token: meta,
    misnamed_env_keys: misnamed,
  })
}


// ─── Meta token introspection ────────────────────────────────────────

interface MetaTokenInfo {
  configured:    boolean
  /** 'OK' / 'EXPIRED' / 'EXPIRES_SOON' / 'INVALID' / 'NO_NETWORK' */
  status:        'OK' | 'EXPIRES_SOON' | 'EXPIRED' | 'INVALID' | 'NO_NETWORK' | 'NOT_CONFIGURED'
  /** Seconds until expiration. -1 if expired, 0 if never expires
   *  (System User tokens), positive integer otherwise. */
  expires_in_s?: number
  expires_at?:   string
  scopes?:       string[]
  type?:         string  // 'USER' / 'PAGE' / 'SYSTEM_USER' / 'APP'
  app_id?:       string
  /** Sanitized provider error (no token leakage). */
  error?:        string
}

const META_WARN_DAYS = 7    // flag as EXPIRES_SOON if under 7 days left

async function metaTokenIntrospect(): Promise<MetaTokenInfo> {
  const token = process.env.META_PAGE_ACCESS_TOKEN
  if (!token) return { configured: false, status: 'NOT_CONFIGURED' }
  try {
    // Use the token to inspect itself via /debug_token. Caller doesn't
    // need the app secret — Meta accepts the same token as the
    // inspector for self-introspection.
    const url = `https://graph.facebook.com/v20.0/debug_token?input_token=${encodeURIComponent(token)}&access_token=${encodeURIComponent(token)}`
    const r = await fetch(url, { cache: 'no-store' })
    const json = await r.json().catch(() => ({})) as {
      data?: {
        is_valid?:    boolean
        expires_at?:  number   // unix seconds; 0 = never
        scopes?:      string[]
        type?:        string
        app_id?:      string
      }
      error?: { message?: string }
    }
    if (!r.ok || !json.data) {
      return { configured: true, status: 'INVALID', error: json.error?.message ?? `HTTP ${r.status}` }
    }
    const d = json.data
    if (!d.is_valid) {
      return { configured: true, status: 'INVALID', error: 'token marked invalid by /debug_token' }
    }
    const now = Math.floor(Date.now() / 1000)
    const expires_at = d.expires_at ?? 0
    // expires_at = 0 means System User token (never expires) — the prod path.
    if (expires_at === 0) {
      return {
        configured: true, status: 'OK',
        expires_in_s: 0, scopes: d.scopes, type: d.type, app_id: d.app_id,
      }
    }
    const remaining = expires_at - now
    if (remaining <= 0) {
      return {
        configured: true, status: 'EXPIRED', expires_in_s: -1,
        expires_at: new Date(expires_at * 1000).toISOString(),
        scopes: d.scopes, type: d.type, app_id: d.app_id,
        error: 'token already expired — rotate immediately',
      }
    }
    const status: MetaTokenInfo['status'] =
      remaining < META_WARN_DAYS * 86_400 ? 'EXPIRES_SOON' : 'OK'
    return {
      configured: true, status,
      expires_in_s: remaining,
      expires_at: new Date(expires_at * 1000).toISOString(),
      scopes: d.scopes, type: d.type, app_id: d.app_id,
    }
  } catch (e) {
    return { configured: true, status: 'NO_NETWORK', error: e instanceof Error ? e.message.slice(0, 200) : 'network error' }
  }
}


// ─── Misnamed env key detector ───────────────────────────────────────

/** Known typo → correct mapping. Add new pairs as we hit them. */
const MISNAME_MAP: Array<{ wrong: string; right: string; note: string }> = [
  { wrong: 'DISCORD_WEBHOOK_BUGREPORTS_URL',       right: 'DISCORD_WEBHOOK_BUG_REPORTS_URL',
    note: 'underscore between BUG and REPORTS' },
  { wrong: 'DISCORD_WEBHOOK_MARKETINTEL_URL',      right: 'DISCORD_WEBHOOK_MARKET_INTEL_URL',
    note: 'underscore between MARKET and INTEL' },
  { wrong: 'DISCORD_WEBHOOK_ALGOUPDATES_URL',      right: 'DISCORD_WEBHOOK_ALGO_UPDATES_URL',
    note: 'underscore between ALGO and UPDATES' },
  { wrong: 'DISCORD_WEBHOOK_SIGNALS_PREMIUM',      right: 'DISCORD_WEBHOOK_SIGNALS_PREMIUM_URL',
    note: 'trailing _URL is required' },
  { wrong: 'META_FACEBOOK_ACCESS_TOKEN',           right: 'META_PAGE_ACCESS_TOKEN',
    note: 'the code reads META_PAGE_ACCESS_TOKEN — one token serves both FB and IG' },
  { wrong: 'TELEGRAM_ID',                          right: 'GROWTH_TELEGRAM_CHANNEL_ID',
    note: 'this is the growth-bot channel posting target' },
  { wrong: 'TELEGRAM_CHANNEL_ID',                  right: 'GROWTH_TELEGRAM_CHANNEL_ID',
    note: 'the Growth Engine reads the GROWTH_ prefix to distinguish from the engine bot' },
]

function detectMisnamedEnvKeys(): Array<{ wrong: string; right: string; note: string }> {
  return MISNAME_MAP.filter((m) => process.env[m.wrong] && !process.env[m.right])
}
