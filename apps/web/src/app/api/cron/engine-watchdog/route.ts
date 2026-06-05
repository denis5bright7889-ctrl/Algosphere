/**
 * /api/cron/engine-watchdog — fast observability watchdog.
 *
 * Catches the failure class that hid for ~35h in the 2026-06 incident:
 * the engine kept publishing signals + regime snapshots, but stopped
 * writing engine_heartbeats and system_event_log — so the daily
 * health-summary (which only checks engine /status + signal counts)
 * reported "healthy" while observability was dead.
 *
 * This runs frequently (see vercel.json) and alarms to Discord when:
 *   - the freshest engine_heartbeats row is stale (> STALE_MIN), OR
 *   - system_event_log received 0 rows in the last hour WHILE signals
 *     were being published (the silent-observability signature).
 *
 * Auth: Bearer ${CRON_SECRET}. Fail-closed when CRON_SECRET is absent.
 * Purely diagnostic — never writes to the engine, only reads + alerts.
 */
import { NextResponse } from 'next/server'
import { createClient as serviceClient } from '@supabase/supabase-js'
import { notify, EMBED_COLOR } from '@/lib/notifications/discord'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const HEARTBEAT_STALE_MIN = 30   // heartbeat older than this = degraded/dead
const EVENT_SILENCE_MIN   = 60   // no system_event_log rows in this window…
const SIGNAL_LOOKBACK_MIN = 360  // …while signals WERE published in last 6h

function svc() {
  return serviceClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}
function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  return (req.headers.get('authorization') ?? '') === `Bearer ${secret}`
}

export async function GET(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const db = svc()
  const now = Date.now()
  const sinceISO = (min: number) => new Date(now - min * 60_000).toISOString()

  // Freshest heartbeat across all components.
  const { data: hb } = await db.from('engine_heartbeats')
    .select('component, last_at').order('last_at', { ascending: false }).limit(1)
  const newest = hb?.[0]
  const hbAgeMin = newest ? Math.round((now - Date.parse(newest.last_at)) / 60_000) : null

  // Event-stream + signal activity windows.
  const [{ count: events1h }, { count: signals6h }] = await Promise.all([
    db.from('system_event_log').select('id', { count: 'exact', head: true }).gte('sent_at', sinceISO(EVENT_SILENCE_MIN)),
    db.from('signals').select('id', { count: 'exact', head: true }).gte('published_at', sinceISO(SIGNAL_LOOKBACK_MIN)),
  ])

  const heartbeatStale = hbAgeMin == null || hbAgeMin > HEARTBEAT_STALE_MIN
  const silentObservability = (events1h ?? 0) === 0 && (signals6h ?? 0) > 0
  const alarm = heartbeatStale || silentObservability

  const reasons: string[] = []
  if (heartbeatStale) reasons.push(newest ? `heartbeat stale: ${newest.component} ${hbAgeMin}m old (> ${HEARTBEAT_STALE_MIN}m)` : 'no engine_heartbeats rows at all')
  if (silentObservability) reasons.push(`system_event_log silent (0 rows/${EVENT_SILENCE_MIN}m) while ${signals6h} signals published/6h — engine alive but observability dead`)

  if (alarm) {
    await notify.health('🔴 AlgoSphere — ENGINE OBSERVABILITY ALARM', {
      embed: {
        title: 'Engine watchdog tripped',
        description: reasons.join('\n'),
        color: EMBED_COLOR.critical,
        fields: [
          { name: 'Newest heartbeat', value: newest ? `${newest.component} · ${hbAgeMin}m ago` : 'NONE', inline: true },
          { name: 'Events (1h)', value: String(events1h ?? 0), inline: true },
          { name: 'Signals (6h)', value: String(signals6h ?? 0), inline: true },
        ],
        timestamp: new Date().toISOString(),
      },
    }).catch(() => {})
  }

  return NextResponse.json({
    ok: true,
    alarm,
    reasons,
    heartbeat_age_min: hbAgeMin,
    newest_component: newest?.component ?? null,
    events_1h: events1h ?? 0,
    signals_6h: signals6h ?? 0,
  })
}

export const POST = GET
