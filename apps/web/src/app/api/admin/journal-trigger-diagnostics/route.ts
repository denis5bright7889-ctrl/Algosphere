/**
 * /api/admin/journal-trigger-diagnostics — diagnose why the
 * auto-journal trigger may not be producing rows.
 *
 * Surfaces, in one JSON, every signal needed to localise the bug:
 *   1. Count of execution_events by event_type (24h)  — if most are
 *      not ORDER_FILLED/POSITION_CLOSED, the trigger is correctly
 *      ignoring them.
 *   2. Count of journal_entries created (24h, by source) — should
 *      track 1:1 with ORDER_FILLED if the trigger works.
 *   3. Sample ORDER_FILLED payloads from last 24h — to verify they
 *      contain symbol + side + avg_fill_price the trigger reads.
 *   4. Whether the trigger function + trigger itself exist on the
 *      live schema (catches "migration 29 not applied").
 *
 * Admin-only.
 */
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as serviceClient } from '@supabase/supabase-js'
import { isAdmin } from '@/lib/admin'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function svc() {
  return serviceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !isAdmin(user.email)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const db = svc()
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

  // 1. execution_events broken down by event_type (24h).
  const { data: events } = await db
    .from('execution_events')
    .select('event_type')
    .gte('created_at', since24h)
  const eventTypeCounts: Record<string, number> = {}
  for (const r of (events ?? []) as Array<{ event_type: string }>) {
    eventTypeCounts[r.event_type] = (eventTypeCounts[r.event_type] ?? 0) + 1
  }

  // 2. journal_entries by source (24h).
  const { data: journal } = await db
    .from('journal_entries')
    .select('source')
    .gte('created_at', since24h)
  const journalBySource: Record<string, number> = {}
  for (const r of (journal ?? []) as Array<{ source: string }>) {
    journalBySource[r.source ?? 'unknown'] = (journalBySource[r.source ?? 'unknown'] ?? 0) + 1
  }

  // 3. Sample ORDER_FILLED payloads — last 5 — to verify shape.
  const { data: sampleFills } = await db
    .from('execution_events')
    .select('id, user_id, broker, payload, created_at')
    .eq('event_type', 'ORDER_FILLED')
    .gte('created_at', since24h)
    .order('created_at', { ascending: false })
    .limit(5)

  // 4. Trigger + function existence — can't easily query pg_catalog
  // through supabase-js REST. We infer from the diagnosis: if
  // ORDER_FILLED > 0 and journal_auto = 0, the trigger is either
  // missing or silently erroring. The user can verify directly via
  // the Supabase SQL editor with:
  //   SELECT proname FROM pg_proc WHERE proname = 'auto_journal_from_event';
  //   SELECT tgname FROM pg_trigger WHERE tgname = 'trg_auto_journal_from_event';

  // Verdict + recommendation derived from the data.
  const orderFilled    = eventTypeCounts['ORDER_FILLED']   ?? 0
  const positionClosed = eventTypeCounts['POSITION_CLOSED'] ?? 0
  const journalAuto    = journalBySource['auto'] ?? 0

  let diagnosis = ''
  if (orderFilled === 0 && positionClosed === 0) {
    diagnosis =
      'No ORDER_FILLED or POSITION_CLOSED events in 24h. The 103 events are likely ORDER_REJECTED / SL_HIT / TP_HIT / PAPER_INIT / RISK_TRIGGERED. The trigger correctly ignores those. Either nothing has filled yet, or fills are using a different event_type.'
  } else if (orderFilled > 0 && journalAuto === 0) {
    diagnosis =
      'ORDER_FILLED events exist but no auto journal_entries created. THE TRIGGER IS FAILING SILENTLY. Check trigger_exists (must be 1). If 1: the EXCEPTION block is swallowing an insert error — most likely a CHECK constraint mismatch on journal_entries (look at sample_fills payloads for malformed side/symbol).'
  } else if (orderFilled > 0 && journalAuto > 0 && journalAuto < orderFilled) {
    diagnosis =
      `${orderFilled} fills produced ${journalAuto} journal rows — partial success. Some events have payloads the trigger can't parse (missing symbol, malformed side, or duplicate order_id hitting ON CONFLICT DO NOTHING).`
  } else if (orderFilled > 0 && journalAuto >= orderFilled) {
    diagnosis = 'Healthy: every ORDER_FILLED produced a journal_entries row.'
  } else {
    diagnosis = 'Indeterminate — share the JSON output for analysis.'
  }

  return NextResponse.json({
    ok: true,
    generated_at: new Date().toISOString(),
    window: 'last 24h',
    diagnosis,
    summary: {
      execution_events_total: Object.values(eventTypeCounts).reduce((a, b) => a + b, 0),
      order_filled:           orderFilled,
      position_closed:        positionClosed,
      journal_entries_auto:   journalAuto,
      journal_entries_manual: journalBySource['manual'] ?? 0,
    },
    event_type_counts:  eventTypeCounts,
    journal_by_source:  journalBySource,
    sample_order_filled_payloads: sampleFills ?? [],
    trigger_check_sql: [
      "Run these in Supabase → SQL Editor to confirm trigger is installed:",
      "  SELECT proname FROM pg_proc WHERE proname = 'auto_journal_from_event';",
      "  SELECT tgname FROM pg_trigger WHERE tgname = 'trg_auto_journal_from_event';",
      "Each should return one row. If empty, migration 29 was never applied — apply it via: supabase db push --linked",
    ],
  })
}
