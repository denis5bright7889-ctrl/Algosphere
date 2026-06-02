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

  return NextResponse.json({
    checked_at: new Date().toISOString(),
    summary,
    checks,
  })
}
