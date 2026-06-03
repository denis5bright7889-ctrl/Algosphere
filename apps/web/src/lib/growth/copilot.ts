/**
 * AI Growth Copilot — synthesizes the past 7 days of platform
 * activity into a ranked daily intelligence brief.
 *
 * Honesty contract:
 *   - The `signals` jsonb persisted on growth_copilot_briefs is the
 *     deterministic ground truth. Every number we surface is computed
 *     here, BEFORE the Gemini call.
 *   - The LLM only writes the narrative + recommendation actions — it
 *     does NOT invent numbers. The system prompt locks it to the
 *     numbers it was given.
 *   - On AI failure (quota, timeout, no key) we still persist the
 *     signals + a deterministic fallback summary, so the brief is
 *     never empty.
 *
 * Pure data-fetch + LLM dispatch. Side effect = one INSERT into
 * growth_copilot_briefs at the end.
 */
import { createClient as serviceClient, type SupabaseClient } from '@supabase/supabase-js'
import { generateJSON, AIError, isAIAvailable } from '@/lib/ai'

export interface CopilotSignals {
  window_start:      string
  window_end:        string
  funnel: {
    visitors:        number
    signups:         number
    broker_connected: number
    trade_synced:    number
    premium_upgrade: number
    /** prev_stage → next_stage conversion rates, 0..1 */
    conv: {
      visitor_to_signup:        number | null
      signup_to_broker:         number | null
      broker_to_trade:          number | null
      trade_to_premium:         number | null
    }
  }
  traffic_sources: Array<{ source: string; n: number }>
  content: {
    published_count: number
    by_kind:         Array<{ kind: string; n: number }>
    top_content:     Array<{ id: string; title: string; kind: string; clicks: number }>
  }
  channels: {
    posts_succeeded: number
    posts_failed:    number
    by_channel:      Array<{ channel: string; ok: number; fail: number }>
  }
  discovery: {
    queue:           number
    replied:         number
    dismissed:       number
  }
}

export interface CopilotAction {
  title:  string
  why:    string
  impact: 'high' | 'medium' | 'low'
}

export interface CopilotBrief {
  window_start: string
  window_end:   string
  signals:      CopilotSignals
  summary_md:   string
  actions:      CopilotAction[]
  model:        string | null
}

function svc(): SupabaseClient {
  return serviceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

const WINDOW_DAYS = 7
const TOP_CONTENT_LIMIT = 5

// ─── Data aggregation ──────────────────────────────────────────────

async function aggregateSignals(): Promise<CopilotSignals> {
  const db = svc()
  const windowEnd   = new Date()
  const windowStart = new Date(windowEnd.getTime() - WINDOW_DAYS * 86_400_000)
  const since = windowStart.toISOString()

  // 1. Funnel events for the window.
  const { data: events } = await db
    .from('growth_attribution_events')
    .select('event, visitor_id, user_id, source_kind, source_id')
    .gte('occurred_at', since)
    .limit(50_000)
  const rows = events ?? []

  const distinct = (k: 'visitor_id' | 'user_id', evt: string) => {
    const s = new Set<string>()
    for (const r of rows) {
      if (r.event !== evt) continue
      const v = r[k]
      if (typeof v === 'string' && v) s.add(v)
    }
    return s.size
  }

  const visitors        = distinct('visitor_id', 'pageview')
  const signups         = distinct('user_id',    'signup')
  const broker          = distinct('user_id',    'broker_connected')
  const trade           = distinct('user_id',    'trade_synced')
  const premium         = distinct('user_id',    'premium_upgrade')

  // Source breakdown of pageview traffic.
  const srcMap: Record<string, number> = {}
  for (const r of rows) {
    if (r.event !== 'pageview') continue
    const k = r.source_kind ?? 'direct'
    srcMap[k] = (srcMap[k] ?? 0) + 1
  }
  const traffic_sources = Object.entries(srcMap)
    .map(([source, n]) => ({ source, n }))
    .sort((a, b) => b.n - a.n)

  // 2. Content published in window.
  const { data: pubItems } = await db
    .from('growth_content_items')
    .select('id, title, kind, published_at')
    .eq('status', 'published')
    .gte('published_at', since)
    .order('published_at', { ascending: false })
    .limit(500)
  const items = (pubItems ?? []) as Array<{ id: string; title: string; kind: string }>

  const kindMap: Record<string, number> = {}
  for (const c of items) kindMap[c.kind] = (kindMap[c.kind] ?? 0) + 1
  const by_kind = Object.entries(kindMap).map(([kind, n]) => ({ kind, n })).sort((a, b) => b.n - a.n)

  // Top content — by attribution click-events that reference content
  // ids (Phase 4D MVP doesn't capture per-item clicks yet, so this
  // stays empty until the click tracker lands. Honest placeholder.)
  const top_content: CopilotSignals['content']['top_content'] = []

  // 3. Channel performance.
  const { data: posts } = await db
    .from('growth_scheduled_posts')
    .select('channel, status')
    .gte('send_at', since)
    .limit(2_000)
  const chMap: Record<string, { ok: number; fail: number }> = {}
  let succeeded = 0
  let failed    = 0
  for (const p of (posts ?? [])) {
    const row = chMap[p.channel] ?? { ok: 0, fail: 0 }
    if (p.status === 'posted') { row.ok += 1; succeeded += 1 }
    else if (p.status === 'failed') { row.fail += 1; failed += 1 }
    chMap[p.channel] = row
  }
  const by_channel = Object.entries(chMap)
    .map(([channel, { ok, fail }]) => ({ channel, ok, fail }))
    .sort((a, b) => (b.ok + b.fail) - (a.ok + a.fail))

  // 4. Discovery queue health.
  const { data: discRows } = await db
    .from('growth_discovery_items')
    .select('status')
    .gte('created_at', since)
    .limit(2_000)
  const dCount = { queue: 0, replied: 0, dismissed: 0 }
  for (const d of (discRows ?? [])) {
    if (d.status === 'queued' || d.status === 'drafting') dCount.queue += 1
    else if (d.status === 'replied')   dCount.replied   += 1
    else if (d.status === 'dismissed') dCount.dismissed += 1
  }

  const safeRatio = (num: number, denom: number): number | null =>
    denom > 0 ? num / denom : null

  return {
    window_start: windowStart.toISOString(),
    window_end:   windowEnd.toISOString(),
    funnel: {
      visitors,
      signups,
      broker_connected: broker,
      trade_synced:     trade,
      premium_upgrade:  premium,
      conv: {
        visitor_to_signup: safeRatio(signups, visitors),
        signup_to_broker:  safeRatio(broker,  signups),
        broker_to_trade:   safeRatio(trade,   broker),
        trade_to_premium:  safeRatio(premium, trade),
      },
    },
    traffic_sources,
    content: {
      published_count: items.length,
      by_kind,
      top_content,
    },
    channels: {
      posts_succeeded: succeeded,
      posts_failed:    failed,
      by_channel,
    },
    discovery: dCount,
  }
}

// ─── LLM synthesis ─────────────────────────────────────────────────

interface CopilotResponse {
  summary_md: string
  actions:    CopilotAction[]
}

function isCopilotResponse(raw: unknown): raw is CopilotResponse {
  if (typeof raw !== 'object' || raw === null) return false
  const r = raw as Record<string, unknown>
  if (typeof r.summary_md !== 'string') return false
  if (!Array.isArray(r.actions)) return false
  for (const a of r.actions) {
    if (typeof a !== 'object' || a === null) return false
    const x = a as Record<string, unknown>
    if (typeof x.title !== 'string') return false
    if (typeof x.why   !== 'string') return false
    if (x.impact !== 'high' && x.impact !== 'medium' && x.impact !== 'low') return false
  }
  return true
}

const SYSTEM = [
  'You are the AlgoSphere Growth Copilot. You read a JSON snapshot of',
  'the last 7 days of platform activity and write a SHORT, CANDID',
  'intelligence brief for the founder.',
  '',
  'STRICT RULES:',
  '  1. Every number in your prose MUST come from the snapshot below.',
  '     Do not invent counts, percentages, or trends. If a number is',
  '     zero, say it is zero.',
  '  2. Lead with the biggest conversion bottleneck (lowest stage-to-',
  '     stage rate in funnel.conv). Name the rate.',
  '  3. Voice: direct, expert, no hype. No marketing language.',
  '     Short paragraphs. Markdown.',
  '  4. End with 2-5 ACTIONS in the JSON `actions` array. Each action',
  '     must be specific (e.g. "Reduce friction on /brokers/new — only',
  '     X% of signups connect a broker"), tied to a real signal,',
  '     and tagged with impact: high | medium | low.',
  '  5. Output ONLY valid JSON matching this schema (no preamble):',
  '       { "summary_md": "...", "actions": [{ "title", "why", "impact" }] }',
].join('\n')


export async function generateCopilotBrief(byUserId?: string): Promise<CopilotBrief> {
  const signals = await aggregateSignals()

  let summary_md: string
  let actions:    CopilotAction[]
  let modelName:  string | null = null

  if (!isAIAvailable()) {
    ;({ summary_md, actions } = deterministicFallback(signals))
  } else {
    try {
      const parsed = await generateJSON<CopilotResponse>({
        prompt:            JSON.stringify(signals, null, 2),
        systemInstruction: SYSTEM,
        model:             'gemini-flash-latest',
        maxTokens:         1500,
        temperature:       0.35,
        timeoutMs:         25_000,
        validate:          isCopilotResponse,
      })
      summary_md = parsed.summary_md
      actions    = parsed.actions.slice(0, 5)
      modelName  = 'gemini-flash-latest'
    } catch (e) {
      if (e instanceof AIError) {
        ;({ summary_md, actions } = deterministicFallback(signals))
      } else {
        throw e
      }
    }
  }

  // Persist.
  const db = svc()
  const { data: row } = await db
    .from('growth_copilot_briefs')
    .insert({
      window_start: signals.window_start,
      window_end:   signals.window_end,
      signals,
      summary_md,
      actions,
      model:        modelName,
      generated_by: byUserId ?? null,
    })
    .select('window_start, window_end, signals, summary_md, actions, model')
    .single()

  return {
    window_start: row?.window_start ?? signals.window_start,
    window_end:   row?.window_end   ?? signals.window_end,
    signals,
    summary_md,
    actions,
    model:        modelName,
  }
}

function deterministicFallback(s: CopilotSignals): { summary_md: string; actions: CopilotAction[] } {
  const bottleneck = bottleneckLabel(s.funnel.conv)
  const summary_md = [
    `**7-day platform snapshot** (${formatDay(s.window_start)} → ${formatDay(s.window_end)}).`,
    '',
    `${s.funnel.visitors.toLocaleString()} visitors → ${s.funnel.signups} signups → ${s.funnel.broker_connected} broker-connected → ${s.funnel.trade_synced} first-trade → ${s.funnel.premium_upgrade} premium.`,
    '',
    `**Conversion**: visitor→signup ${pct(s.funnel.conv.visitor_to_signup)} · signup→broker ${pct(s.funnel.conv.signup_to_broker)} · broker→trade ${pct(s.funnel.conv.broker_to_trade)} · trade→premium ${pct(s.funnel.conv.trade_to_premium)}.`,
    '',
    `**Biggest bottleneck**: ${bottleneck}.`,
    '',
    `**Content**: ${s.content.published_count} item${s.content.published_count === 1 ? '' : 's'} published. Channels: ${s.channels.posts_succeeded} posts succeeded, ${s.channels.posts_failed} failed.`,
    '',
    `_AI provider not configured — deterministic summary only. Add AI_STUDIO_API_KEY or GEMINI_API_KEY to Vercel env to unlock LLM-generated recommendations._`,
  ].join('\n')

  const actions: CopilotAction[] = []
  // Tie the deterministic actions to whichever bottleneck is worst.
  const c = s.funnel.conv
  if (c.signup_to_broker != null && c.signup_to_broker < 0.30 && s.funnel.signups > 0) {
    actions.push({
      title:  'Reduce friction on broker connection',
      why:    `Only ${pct(c.signup_to_broker)} of signups connect a broker. The /brokers add flow is the first hard step — usability there is the highest-impact lever.`,
      impact: 'high',
    })
  }
  if (c.broker_to_trade != null && c.broker_to_trade < 0.40 && s.funnel.broker_connected > 0) {
    actions.push({
      title:  'Surface "first trade" prompts after broker connect',
      why:    `${pct(c.broker_to_trade)} of broker-connected users place a first trade. The post-connect dashboard could nudge with a curated active signal.`,
      impact: 'high',
    })
  }
  if (s.content.published_count === 0) {
    actions.push({
      title:  'Publish at least one piece this week',
      why:    'No content has been published in the past 7 days. Growth Engine + Discovery queue are dark — flip on the educational drip.',
      impact: 'medium',
    })
  }
  if (s.discovery.queue > 0 && s.discovery.replied === 0) {
    actions.push({
      title:  'Drain the discovery queue',
      why:    `${s.discovery.queue} relevant Reddit threads are waiting in /admin/growth/discovery. Zero replies posted this week — that's free distribution sitting unused.`,
      impact: 'medium',
    })
  }
  if (actions.length === 0) {
    actions.push({
      title:  'Hold course',
      why:    'No outlier bottleneck this window. Keep cadence and re-check next cycle.',
      impact: 'low',
    })
  }
  return { summary_md, actions }
}

function bottleneckLabel(conv: CopilotSignals['funnel']['conv']): string {
  const entries: Array<[string, number | null]> = [
    ['visitor → signup',  conv.visitor_to_signup],
    ['signup → broker',   conv.signup_to_broker],
    ['broker → trade',    conv.broker_to_trade],
    ['trade → premium',   conv.trade_to_premium],
  ]
  const valid = entries.filter((e): e is [string, number] => typeof e[1] === 'number')
  if (valid.length === 0) return 'insufficient data — funnel events are too thin to score'
  valid.sort((a, b) => a[1] - b[1])
  const [stage, rate] = valid[0]!
  return `${stage} at ${pct(rate)}`
}

function pct(v: number | null): string {
  if (v == null) return '—'
  return `${(v * 100).toFixed(1)}%`
}
function formatDay(iso: string): string {
  return iso.slice(0, 10)
}
