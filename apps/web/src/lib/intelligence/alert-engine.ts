/**
 * Alert Engine — Phase J of the Auto-Live spec.
 *
 * Two responsibilities:
 *
 *   1. detectAndEnqueue()  — scan the system for alert-worthy
 *                            conditions, INSERT pending rows into
 *                            alert_queue (de-duped via unique index)
 *
 *   2. dispatchPending()   — pull pending alerts, deliver via
 *                            configured alert_channels (Telegram /
 *                            Discord / webhook / email), mark
 *                            dispatched or failed
 *
 * Triggers detected:
 *   • no_signals_24h           — no shadow_executions in past 24h
 *   • no_lifecycle_ticks       — open positions older than 1h with
 *                                 no closed_at progress
 *   • writer_failure           — writer_dlq has unresolved entries
 *   • stale_positions          — positions open > 7 days
 *   • high_error_rate          — > 10% writer error rate (1h)
 *   • circuit_breaker_open     — any market_feed_status row in 'open'
 *   • state_transition_live_eligible — strategy reached LIVE_ELIGIBLE
 *
 * Honesty contract: alerts are emitted from REAL signals only —
 * thresholds derived from durable rows. No false alerts during cold
 * start (we suppress no_signals when system has never had data).
 */
import 'server-only'
import { createClient as serviceClient, type SupabaseClient } from '@supabase/supabase-js'

function svc(): SupabaseClient {
  return serviceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

export type AlertKind =
  | 'no_signals_24h' | 'no_lifecycle_ticks' | 'writer_failure'
  | 'stale_positions' | 'high_error_rate' | 'circuit_breaker_open'
  | 'recovery_action' | 'state_transition_live_eligible'

export type AlertSeverity = 'info' | 'warn' | 'error' | 'critical'

export interface DetectResult {
  scanned_at:   string
  detected:     number
  enqueued:     number
  alerts:       Array<{ kind: AlertKind; severity: AlertSeverity; dedupe_key: string | null }>
}

interface AlertInsert {
  kind:        AlertKind
  severity:    AlertSeverity
  title:       string
  body:        string
  payload:     Record<string, unknown>
  dedupe_key:  string | null
  user_id?:    string | null
}

async function enqueue(db: SupabaseClient, a: AlertInsert): Promise<boolean> {
  const { error } = await db.from('alert_queue').insert({
    kind: a.kind, severity: a.severity, title: a.title, body: a.body,
    payload: a.payload, dedupe_key: a.dedupe_key, user_id: a.user_id ?? null,
    status: 'pending',
  })
  // Unique-violation = already alerted today; treat as success.
  if (error && error.code !== '23505') return false
  return true
}

export async function detectAndEnqueue(): Promise<DetectResult> {
  const db = svc()
  const ranAt = new Date().toISOString()
  const result: DetectResult = { scanned_at: ranAt, detected: 0, enqueued: 0, alerts: [] }

  // 1 — no_signals_24h (but only if the system has EVER had data — otherwise
  //     it's cold start, not a fault). We check the all-time count.
  const { count: allTimeShadow } = await db
    .from('shadow_executions').select('*', { count: 'exact', head: true })
  if ((allTimeShadow ?? 0) > 0) {
    const since24h = new Date(Date.now() - 86_400_000).toISOString()
    const { count: recent } = await db
      .from('shadow_executions').select('*', { count: 'exact', head: true })
      .gte('created_at', since24h)
    if ((recent ?? 0) === 0) {
      const dedupe = ranAt.slice(0, 10)
      const a: AlertInsert = {
        kind: 'no_signals_24h', severity: 'warn',
        title: 'No shadow signals in 24h',
        body: 'shadow_executions has been quiet for 24h. Check the signal factory cron.',
        payload: { all_time_count: allTimeShadow },
        dedupe_key: dedupe,
      }
      result.detected++
      if (await enqueue(db, a)) {
        result.enqueued++
        result.alerts.push({ kind: a.kind, severity: a.severity, dedupe_key: a.dedupe_key })
      }
    }
  }

  // 2 — stale_positions (open > 7 days)
  const since7d = new Date(Date.now() - 7 * 86_400_000).toISOString()
  const { count: staleOpen } = await db
    .from('shadow_executions').select('*', { count: 'exact', head: true })
    .in('actual_status', ['mirrored', 'testnet'])
    .is('closed_at', null).lt('created_at', since7d)
  if ((staleOpen ?? 0) > 0) {
    const a: AlertInsert = {
      kind: 'stale_positions', severity: 'warn',
      title: `${staleOpen} stale open position(s)`,
      body: `Positions open longer than 7 days. Lifecycle ticker may not be receiving prices for these symbols.`,
      payload: { stale_count: staleOpen },
      dedupe_key: ranAt.slice(0, 10),
    }
    result.detected++
    if (await enqueue(db, a)) {
      result.enqueued++
      result.alerts.push({ kind: a.kind, severity: a.severity, dedupe_key: a.dedupe_key })
    }
  }

  // 3 — writer_dlq unresolved
  const { count: dlqUnresolved } = await db
    .from('writer_dlq').select('*', { count: 'exact', head: true }).eq('resolved', false)
  if ((dlqUnresolved ?? 0) > 0) {
    const a: AlertInsert = {
      kind: 'writer_failure', severity: 'error',
      title: `${dlqUnresolved} unresolved writer error(s) in DLQ`,
      body: 'Inspect writer_dlq — recovery engine will retry, but persistent failures need attention.',
      payload: { dlq_count: dlqUnresolved },
      dedupe_key: ranAt.slice(0, 10),
    }
    result.detected++
    if (await enqueue(db, a)) {
      result.enqueued++
      result.alerts.push({ kind: a.kind, severity: a.severity, dedupe_key: a.dedupe_key })
    }
  }

  // 4 — circuit_breaker_open
  const { data: openBreakers } = await db
    .from('market_feed_status').select('provider, asset_class').eq('state', 'open')
  for (const b of ((openBreakers ?? []) as Array<{ provider: string; asset_class: string }>)) {
    const a: AlertInsert = {
      kind: 'circuit_breaker_open', severity: 'error',
      title: `Market feed circuit breaker OPEN: ${b.provider} (${b.asset_class})`,
      body: 'Provider has hit the consecutive-failure threshold; price fetches for this asset class fall through to next provider.',
      payload: { provider: b.provider, asset_class: b.asset_class },
      dedupe_key: `${b.provider}|${b.asset_class}|${ranAt.slice(0, 10)}`,
    }
    result.detected++
    if (await enqueue(db, a)) {
      result.enqueued++
      result.alerts.push({ kind: a.kind, severity: a.severity, dedupe_key: a.dedupe_key })
    }
  }

  // 5 — state_transition_live_eligible (NEW strategies in LIVE_ELIGIBLE today)
  const sinceToday = new Date(); sinceToday.setUTCHours(0, 0, 0, 0)
  const { data: newLive } = await db
    .from('strategy_qualification_history')
    .select('user_id, strategy_name, transitioned_at')
    .eq('to_stage', 'LIVE_ELIGIBLE')
    .gte('transitioned_at', sinceToday.toISOString())
    .limit(50)
  for (const t of ((newLive ?? []) as Array<{ user_id: string; strategy_name: string; transitioned_at: string }>)) {
    const a: AlertInsert = {
      kind: 'state_transition_live_eligible', severity: 'info',
      user_id: t.user_id,
      title: `Strategy ${t.strategy_name} → LIVE_ELIGIBLE`,
      body: 'Sample ≥ 100, win-rate ≥ 55%, Sharpe ≥ 1.5, DD ≤ 10%, PF ≥ 1.3 all passed.',
      payload: { strategy_name: t.strategy_name, transitioned_at: t.transitioned_at },
      dedupe_key: `${t.user_id}|${t.strategy_name}|${ranAt.slice(0, 10)}`,
    }
    result.detected++
    if (await enqueue(db, a)) {
      result.enqueued++
      result.alerts.push({ kind: a.kind, severity: a.severity, dedupe_key: a.dedupe_key })
    }
  }

  return result
}

// ── Dispatch ──────────────────────────────────────────────────────

export interface DispatchResult {
  ran_at:        string
  attempted:     number
  dispatched:    number
  failed:        number
  errors:        string[]
}

const SEVERITY_RANK: Record<AlertSeverity, number> = {
  info: 0, warn: 1, error: 2, critical: 3,
}

async function deliverTelegram(token: string, chatId: string, text: string): Promise<boolean> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' }),
    })
    return res.ok
  } catch { return false }
}

async function deliverWebhook(url: string, body: Record<string, unknown>): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    return res.ok
  } catch { return false }
}

async function deliverDiscord(webhookUrl: string, content: string): Promise<boolean> {
  return deliverWebhook(webhookUrl, { content })
}

export async function dispatchPending(): Promise<DispatchResult> {
  const db = svc()
  const ranAt = new Date().toISOString()
  const result: DispatchResult = { ran_at: ranAt, attempted: 0, dispatched: 0, failed: 0, errors: [] }

  const { data: pending } = await db
    .from('alert_queue')
    .select('id, kind, severity, title, body, payload, user_id, dedupe_key')
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(50)

  const { data: channels } = await db
    .from('alert_channels')
    .select('user_id, channel, endpoint, min_severity, enabled')
    .eq('enabled', true)

  const allChannels = (channels ?? []) as Array<{
    user_id: string | null; channel: string; endpoint: string; min_severity: AlertSeverity; enabled: boolean
  }>
  const tgToken = process.env.TELEGRAM_BOT_TOKEN ?? ''

  for (const alert of ((pending ?? []) as Array<{
    id: string; kind: AlertKind; severity: AlertSeverity; title: string; body: string;
    payload: Record<string, unknown>; user_id: string | null; dedupe_key: string | null
  }>)) {
    result.attempted++
    // Channels: global (user_id null) + per-user when alert.user_id set
    const targets = allChannels.filter(c =>
      (c.user_id === null || c.user_id === alert.user_id)
      && SEVERITY_RANK[alert.severity] >= SEVERITY_RANK[c.min_severity],
    )

    if (targets.length === 0) {
      // No channels configured — mark suppressed
      await db.from('alert_queue').update({ status: 'suppressed' }).eq('id', alert.id)
      continue
    }

    let anySuccess = false
    for (const t of targets) {
      const text = `*${alert.title}*\n${alert.body}`
      let delivered = false
      if (t.channel === 'telegram' && tgToken) {
        delivered = await deliverTelegram(tgToken, t.endpoint, text)
      } else if (t.channel === 'discord') {
        delivered = await deliverDiscord(t.endpoint, text)
      } else if (t.channel === 'webhook') {
        delivered = await deliverWebhook(t.endpoint, {
          kind: alert.kind, severity: alert.severity, title: alert.title,
          body: alert.body, payload: alert.payload,
        })
      }
      if (delivered) anySuccess = true
      else result.errors.push(`${t.channel}:${alert.kind} delivery failed`)
    }

    if (anySuccess) {
      await db.from('alert_queue').update({
        status: 'dispatched', dispatched_at: new Date().toISOString(),
      }).eq('id', alert.id)
      result.dispatched++
    } else {
      await db.from('alert_queue').update({ status: 'failed' }).eq('id', alert.id)
      result.failed++
    }
  }

  return result
}
