/**
 * /api/cron/health-summary — daily engine health digest to Discord.
 *
 * Schedule: declared in vercel.json. Reads the signal-engine /status
 * endpoint plus the kill-switch state, formats a one-message summary,
 * and posts to the DISCORD_WEBHOOK_HEALTH_URL channel.
 *
 * Authentication: Bearer ${CRON_SECRET}, same pattern as the growth
 * publisher cron. Fail-closed when CRON_SECRET is missing.
 */
import { NextResponse } from 'next/server'
import { createClient as serviceClient } from '@supabase/supabase-js'
import { getEngineStatus } from '@/lib/engine-client'
import { notify, EMBED_COLOR } from '@/lib/notifications/discord'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function svc() {
  return serviceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  return (req.headers.get('authorization') ?? '') === `Bearer ${secret}`
}

interface EngineStatusLite {
  ok?:          boolean
  version?:     string
  uptime_s?:    number
  last_scan_at?: string
  scheduler?:   Record<string, { running?: boolean; next_run?: string }>
}

export async function GET(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = svc()

  // Engine status — best-effort. Engine being down IS the news to post.
  let engine: EngineStatusLite | null = null
  let engineErr: string | null = null
  try {
    const res = await getEngineStatus()
    if (res.ok) engine = res.data as EngineStatusLite
    else        engineErr = res.error
  } catch (e) {
    engineErr = e instanceof Error ? e.message : 'unknown'
  }

  // Kill-switch state.
  const { data: risk } = await db.from('global_risk_state')
    .select('kill_switch, reason, activated_by, activated_at').eq('id', true).maybeSingle()

  // 24h signal + payment counts.
  const cutoff = new Date(Date.now() - 86_400_000).toISOString()
  const [
    { count: signals24h },
    { count: payments24h },
  ] = await Promise.all([
    db.from('signals').select('id', { count: 'exact', head: true }).gte('published_at', cutoff),
    db.from('crypto_payments').select('id', { count: 'exact', head: true }).gte('created_at', cutoff),
  ])

  const engineOK = !!engine && engineErr == null
  const killOn   = !!risk?.kill_switch
  const overallOK = engineOK && !killOn

  const color = overallOK
    ? EMBED_COLOR.ok
    : killOn
      ? EMBED_COLOR.critical
      : EMBED_COLOR.warn

  const fields = [
    { name: 'Engine',       value: engineOK ? `up · v${engine?.version ?? '?'}` : `down (${engineErr ?? 'no response'})`, inline: true },
    { name: 'Kill switch',  value: killOn ? `🛑 ON — ${risk?.reason ?? ''}` : '✅ off', inline: true },
    { name: 'Signals 24h',  value: String(signals24h ?? 0), inline: true },
    { name: 'Payments 24h', value: String(payments24h ?? 0), inline: true },
  ]
  if (engine?.last_scan_at) {
    const ageMin = Math.round((Date.now() - new Date(engine.last_scan_at).getTime()) / 60000)
    fields.push({ name: 'Last scan', value: `${ageMin}m ago (${engine.last_scan_at})`, inline: false })
  }

  const result = await notify.health(
    overallOK
      ? '✅ AlgoSphere — daily health'
      : killOn
        ? '🛑 AlgoSphere — daily health (kill switch ACTIVE)'
        : '⚠ AlgoSphere — daily health (engine issue)',
    {
      embed: {
        title:     'Daily engine health',
        color,
        fields,
        timestamp: new Date().toISOString(),
      },
    },
  )

  return NextResponse.json({
    ok:           result.ok,
    posted:       result.ok,
    engine_ok:    engineOK,
    kill_switch:  killOn,
    signals_24h:  signals24h ?? 0,
    payments_24h: payments24h ?? 0,
  })
}

export const POST = GET
