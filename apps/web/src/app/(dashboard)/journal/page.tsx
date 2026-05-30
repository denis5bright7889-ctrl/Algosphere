import { createClient } from '@/lib/supabase/server'
import JournalClient, { type CoachEvalSummary } from './JournalClient'
import { isDemo } from '@/lib/demo'
import { generateDemoJournal } from '@/lib/demo-data'
import type { JournalEntry } from '@/lib/types'

export const metadata = { title: 'Trade Journal' }
export const dynamic = 'force-dynamic'

export default async function JournalPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const [{ data: profile }, { data: entries }, { data: evals }, brokersRes] = await Promise.all([
    supabase.from('profiles').select('account_type').eq('id', user!.id).single(),
    supabase
      .from('journal_entries')
      .select('*')
      .eq('user_id', user!.id)
      .order('trade_date', { ascending: false }),
    // Refocus R4b: pull the user's coach evaluations alongside entries.
    // We pick the LATEST per journal_entry_id below (versions are
    // append-only; the dashboard always reads the freshest).
    supabase
      .from('journal_coach_evaluations')
      .select('id, journal_entry_id, quality_score, strategy_grade, emotional_flag, emotional_reason, advancement, what_to_fix, ai_insights, execution_grade, psychology_grade, risk_grade, discipline_grade, timing_grade, created_at')
      .eq('user_id', user!.id)
      .order('created_at', { ascending: false }),
    // Auto-fill status: does the user have any broker connected? The
    // pipeline (DB trigger on execution_events with source='auto') runs
    // whenever a connected broker reports an ORDER_FILLED event.
    supabase
      .from('broker_connections')
      .select('id, status', { count: 'exact', head: false })
      .eq('user_id', user!.id)
      .eq('status', 'connected'),
  ])

  let displayEntries = (entries ?? []) as JournalEntry[]

  // Demo accounts with an empty journal get prefilled mock trades so analytics
  // looks alive. Once they save a real entry, demo entries disappear.
  if (isDemo(profile?.account_type) && displayEntries.length === 0) {
    displayEntries = generateDemoJournal(user!.id, 25)
  }

  // Build entryId → latest CoachEvalSummary. evals already sorted
  // newest-first, so first hit per entry wins.
  const coachByEntry: Record<string, CoachEvalSummary> = {}
  type EvalRow = {
    id:                string
    journal_entry_id:  string
    quality_score:     number
    strategy_grade:    CoachEvalSummary['strategy_grade']
    emotional_flag:    boolean
    emotional_reason:  string | null
    advancement:       string | null
    what_to_fix:       string[] | null
    ai_insights:       string[] | null
    execution_grade:   number | null
    psychology_grade:  number | null
    risk_grade:        number | null
    discipline_grade:  number | null
    timing_grade:      number | null
    created_at:        string
  }
  for (const row of ((evals ?? []) as unknown as EvalRow[])) {
    if (coachByEntry[row.journal_entry_id]) continue
    coachByEntry[row.journal_entry_id] = {
      quality_score:    row.quality_score,
      strategy_grade:   row.strategy_grade,
      emotional_flag:   row.emotional_flag,
      emotional_reason: row.emotional_reason,
      advancement:      row.advancement,
      top_fix:          row.what_to_fix?.[0] ?? null,
      execution_grade:  row.execution_grade,
      psychology_grade: row.psychology_grade,
      risk_grade:       row.risk_grade,
      discipline_grade: row.discipline_grade,
      timing_grade:     row.timing_grade,
      ai_insights:      row.ai_insights ?? [],
    }
  }

  const connectedBrokerCount = brokersRes.data?.length ?? 0
  // V4: 'auto' is the pre-migration value; 'auto_human' is its successor;
  // 'auto_engine' is the new engine-execution variant. The banner counts
  // all non-manual rows together to convey "auto-fill is active".
  const autoEntryCount = displayEntries.filter((e) => {
    const s = (e as { source?: string }).source
    return s === 'auto' || s === 'auto_human' || s === 'auto_engine'
  }).length

  return (
    <JournalClient
      initialEntries={displayEntries}
      userId={user!.id}
      coachByEntry={coachByEntry}
      connectedBrokerCount={connectedBrokerCount}
      autoEntryCount={autoEntryCount}
    />
  )
}
