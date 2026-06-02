/**
 * Automation engine — evaluate enabled rules against an incoming event,
 * fire matching content generators, and persist a row in the event log.
 *
 * Pure orchestration. Side-effects: DB writes (content_items,
 * event_log, scheduled_posts). Used by /api/automation/events.
 *
 * Honesty contract:
 *   - Every generated content_item carries the source event payload in
 *     its `provenance` jsonb so the claim can be audited back.
 *   - is_synthetic is set to true when the source is a backtest /
 *     hypothetical event (e.g. backtest.completed).
 *   - Auto-publish (output_status='published') is gated to a small
 *     whitelist of content kinds at the DB write — even if a rule
 *     mis-configures, performance claims can't bypass review.
 */
import { createClient as serviceClient, type SupabaseClient } from '@supabase/supabase-js'
import {
  generateStrategyOfTheWeek, generateBacktestBreakdown,
  generateEducational, generateProductUpdate, generateMarketReport,
  type GeneratedDraft, type ContentKind,
} from './generators'

// ── Content kinds that may auto-publish (skip the draft → review →
//    approved → published gauntlet). Anything outside this set forces
//    output_status='draft' regardless of what the rule says.
const AUTO_PUBLISH_KINDS = new Set<ContentKind>([
  'market_report',      // engine snapshot, no individual perf claims
  'educational',        // tutorial / explainer
  'announcement',       // labelled brand announcement
  'psychology_insight', // aggregated behavioural copy
])

export type EventType =
  | 'signal.published'
  | 'signal.tp_hit'
  | 'signal.sl_hit'
  | 'trade.opened'
  | 'trade.closed'
  | 'backtest.completed'
  | 'strategy.released'
  | 'regime.changed'
  | 'volatility.spiked'
  | 'performance.weekly'
  | 'performance.monthly'
  | 'feature.released'
  | 'user.milestone'
  | 'manual.fire'

export interface IngestedEvent {
  /** Stable event-type string. New types just need a rule row. */
  event_type: EventType | string
  /** Free-form payload — the rule's predicate + the generator both
   *  read fields off it. */
  payload:    Record<string, unknown>
  /** 'signal-engine' | 'web' | 'cron' | 'admin' */
  source:     string
}

interface AutomationRuleRow {
  id:            string
  name:          string
  event_type:    string
  predicate:     Record<string, unknown>
  content_kind:  ContentKind
  channels:      string[]
  output_status: 'draft' | 'approved' | 'published'
  enabled:       boolean
  daily_cap:     number | null
}

interface IngestOutcome {
  outcome:     'ok' | 'no_match' | 'rate_limited' | 'error'
  matched:     Array<{ rule_id: string; rule_name: string; content_id: string | null; error?: string }>
  event_log_id: string
}

function svc(): SupabaseClient {
  return serviceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

// ─── Predicate evaluator — keeps the rule language tiny and safe. ──
function evalPredicate(pred: Record<string, unknown>, payload: Record<string, unknown>): boolean {
  if (!pred || Object.keys(pred).length === 0) return true

  for (const [key, expected] of Object.entries(pred)) {
    // Numeric minimums — keys like `min_<field>` map to payload[field] >= value.
    if (key.startsWith('min_')) {
      const field = key.slice(4)
      const v = Number(payload[field])
      if (!Number.isFinite(v) || v < Number(expected)) return false
      continue
    }
    if (key.startsWith('max_')) {
      const field = key.slice(4)
      const v = Number(payload[field])
      if (!Number.isFinite(v) || v > Number(expected)) return false
      continue
    }
    // Membership — `<field>_in: [...]` matches if payload[field] is in the array.
    if (key.endsWith('_in') && Array.isArray(expected)) {
      const field = key.slice(0, -3)
      if (!(expected as unknown[]).includes(payload[field])) return false
      continue
    }
    // Exact equality fallback.
    if (payload[key] !== expected) return false
  }
  return true
}

// ─── Generator dispatch ────────────────────────────────────────────
// Payloads arrive untyped (raw JSON over HTTP), so each branch first
// verifies the required fields, then casts through `unknown` to the
// generator's input shape. Generators themselves are pure — a bad
// shape can only produce a null/throw at the field-access level,
// which the try/catch handles.
function tryGenerate(kind: ContentKind, payload: Record<string, unknown>): GeneratedDraft | null {
  try {
    switch (kind) {
      case 'strategy_of_the_week':
        if (!payload.strategy || !payload.backtest || !payload.grade) return null
        return generateStrategyOfTheWeek(payload as unknown as Parameters<typeof generateStrategyOfTheWeek>[0])

      case 'backtest_breakdown':
        if (!payload.symbol || !payload.timeframe || !payload.bt) return null
        return generateBacktestBreakdown(payload as unknown as Parameters<typeof generateBacktestBreakdown>[0])

      case 'market_report':
        if (!Array.isArray(payload.rows)) return null
        return generateMarketReport(payload as unknown as Parameters<typeof generateMarketReport>[0])

      case 'product_update':
        if (!payload.version || !payload.headline || !Array.isArray(payload.highlights)) return null
        return generateProductUpdate(payload as unknown as Parameters<typeof generateProductUpdate>[0])

      case 'educational':
        if (!payload.topic || !payload.headline || !payload.body) return null
        return generateEducational(payload as unknown as Parameters<typeof generateEducational>[0])

      case 'announcement':
      case 'psychology_insight':
        // No dedicated generator yet — caller must pass a fully-formed
        // draft via payload.draft. Phase 4A.2 adds dedicated generators.
        if (!payload.draft) return null
        return payload.draft as unknown as GeneratedDraft

      default:
        return null
    }
  } catch {
    return null
  }
}

// ─── Daily-cap check ───────────────────────────────────────────────
async function ruleAtCap(db: SupabaseClient, ruleId: string, cap: number | null): Promise<boolean> {
  if (cap == null) return false
  const since = new Date(Date.now() - 86_400_000).toISOString()
  const { count } = await db
    .from('growth_event_log')
    .select('id', { count: 'exact', head: true })
    .gte('created_at', since)
    .contains('rule_ids', [ruleId])
  return (count ?? 0) >= cap
}

// ─── Public entry point ────────────────────────────────────────────
export async function ingestEvent(event: IngestedEvent): Promise<IngestOutcome> {
  const db = svc()

  // 1. Pull every enabled rule for this event_type.
  const { data: rules } = await db
    .from('growth_automation_rules')
    .select('id, name, event_type, predicate, content_kind, channels, output_status, enabled, daily_cap')
    .eq('event_type', event.event_type)
    .eq('enabled', true)

  const candidates = (rules ?? []) as AutomationRuleRow[]

  if (candidates.length === 0) {
    const { data } = await db.from('growth_event_log').insert({
      event_type: event.event_type,
      payload:    event.payload,
      rule_ids:   [],
      content_ids:[],
      outcome:    'no_match',
      source:     event.source,
    }).select('id').single()
    return { outcome: 'no_match', matched: [], event_log_id: data?.id ?? '' }
  }

  // 2. For each candidate, evaluate the predicate, rate-limit check,
  //    generate the draft, persist the content_item, optionally
  //    auto-schedule.
  const matched: IngestOutcome['matched'] = []
  let anyRateLimited = false

  for (const rule of candidates) {
    if (!evalPredicate(rule.predicate, event.payload)) continue

    if (await ruleAtCap(db, rule.id, rule.daily_cap)) {
      anyRateLimited = true
      matched.push({ rule_id: rule.id, rule_name: rule.name, content_id: null, error: 'rate_limited' })
      continue
    }

    const draft = tryGenerate(rule.content_kind, event.payload)
    if (!draft) {
      matched.push({ rule_id: rule.id, rule_name: rule.name, content_id: null, error: 'generator_unsupported_payload' })
      continue
    }

    // Auto-publish whitelist enforcement — even a misconfigured rule
    // can't push a strategy/backtest claim straight to live.
    const effectiveStatus = (rule.output_status === 'published' && !AUTO_PUBLISH_KINDS.has(draft.kind))
      ? 'approved'
      : rule.output_status

    const { data: contentRow, error: insertErr } = await db
      .from('growth_content_items')
      .insert({
        kind:         draft.kind,
        status:       effectiveStatus === 'published' ? 'published'
                      : effectiveStatus === 'approved' ? 'approved'
                      : 'draft',
        title:        draft.title,
        summary:      draft.summary,
        body_md:      draft.body_md,
        tags:         draft.tags,
        is_synthetic: draft.is_synthetic,
        disclaimer:   draft.disclaimer,
        cta_text:     draft.cta_text,
        cta_url:      draft.cta_url,
        provenance:   {
          ...draft.provenance,
          automation_event: event.event_type,
          automation_rule:  rule.name,
        },
        published_at: effectiveStatus === 'published' ? new Date().toISOString() : null,
      })
      .select('id')
      .single()

    if (insertErr || !contentRow) {
      matched.push({ rule_id: rule.id, rule_name: rule.name, content_id: null, error: insertErr?.message ?? 'insert_failed' })
      continue
    }

    // If channels are set + status is approved-or-published, queue the
    // scheduled_posts rows so the cron / post-now path picks them up.
    if (rule.channels.length > 0 && effectiveStatus !== 'draft') {
      const sendAt = new Date().toISOString()
      await db.from('growth_scheduled_posts').insert(
        rule.channels.map((ch) => ({
          content_id: contentRow.id,
          channel:    ch,
          status:     'queued',
          send_at:    sendAt,
        })),
      )
    }

    matched.push({ rule_id: rule.id, rule_name: rule.name, content_id: contentRow.id })
  }

  // 3. Log the event with the rolled-up outcome.
  const ruleIds    = matched.filter((m) => m.content_id).map((m) => m.rule_id)
  const contentIds = matched.filter((m) => m.content_id).map((m) => m.content_id!) as string[]
  const outcome: IngestOutcome['outcome'] =
    contentIds.length > 0 ? 'ok'
    : anyRateLimited       ? 'rate_limited'
    : matched.length > 0   ? 'error'
    :                        'no_match'

  const { data: logRow } = await db.from('growth_event_log').insert({
    event_type:  event.event_type,
    payload:     event.payload,
    rule_ids:    ruleIds,
    content_ids: contentIds,
    outcome,
    source:      event.source,
  }).select('id').single()

  return { outcome, matched, event_log_id: logRow?.id ?? '' }
}
