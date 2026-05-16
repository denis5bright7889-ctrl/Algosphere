import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { generatePsychologyReport } from '@/lib/ai-psychology'
import { isAIAvailable } from '@/lib/ai'

// GET /api/ai/psychology — runs the AI psych coach over the last 30 days
// of journal_entries for the current user.
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!isAIAvailable()) {
    return NextResponse.json({
      error:    'AI provider not configured',
      configure: 'Set GEMINI_API_KEY in your .env file',
    }, { status: 503 })
  }

  // Rate limit: 5 reports/day/user (psychology reports are heavy)
  const today = new Date().toISOString().slice(0, 10)
  const { count: todayCount } = await supabase
    .from('audit_logs')
    .select('id', { count: 'exact', head: true })
    .eq('actor_id', user.id)
    .eq('action', 'ai.psychology')
    .gte('created_at', today)

  if ((todayCount ?? 0) >= 5) {
    return NextResponse.json(
      { error: 'Daily limit (5 reports). Try again tomorrow.' },
      { status: 429 },
    )
  }

  // Aggregate last 30 days
  const cutoff = new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10)
  const { data: trades } = await supabase
    .from('journal_entries')
    .select('pnl, pips, emotion_pre, mistakes, rule_violation, risk_amount, trade_date')
    .eq('user_id', user.id)
    .gte('trade_date', cutoff)

  if (!trades || trades.length < 5) {
    return NextResponse.json({
      error: 'Need at least 5 logged trades in the last 30 days.',
      have:  trades?.length ?? 0,
    }, { status: 400 })
  }

  const pnls = trades.map(t => Number(t.pnl ?? 0))
  const wins   = pnls.filter(p => p > 0).length
  const losses = pnls.filter(p => p < 0).length
  const totalPnl = pnls.reduce((s, p) => s + p, 0)
  const winRate  = trades.length > 0 ? wins / trades.length : 0
  const avgWin   = wins > 0
    ? pnls.filter(p => p > 0).reduce((s, p) => s + p, 0) / wins  : 0
  const avgLoss  = losses > 0
    ? Math.abs(pnls.filter(p => p < 0).reduce((s, p) => s + p, 0)) / losses : 0
  const avgRR    = avgLoss > 0 ? avgWin / avgLoss : 0

  // Max drawdown
  let peak = 0, equity = 0, maxDd = 0
  for (const p of pnls) {
    equity += p
    if (equity > peak) peak = equity
    const dd = peak > 0 ? (peak - equity) / Math.max(peak, 1) : 0
    if (dd > maxDd) maxDd = dd
  }

  // Mistake frequency
  const mistakeCounts: Record<string, number> = {}
  for (const t of trades) {
    for (const m of (t.mistakes ?? []) as string[]) {
      mistakeCounts[m] = (mistakeCounts[m] ?? 0) + 1
    }
  }

  // Emotion breakdown + performance
  const emoCounts: Record<string, number> = {}
  const emoPnl:    Record<string, number> = {}
  for (const t of trades) {
    const e = t.emotion_pre as string | null
    if (!e) continue
    emoCounts[e] = (emoCounts[e] ?? 0) + 1
    emoPnl[e]    = (emoPnl[e] ?? 0) + Number(t.pnl ?? 0)
  }
  const emotions = Object.keys(emoPnl)
  const bestEmotion  = emotions.length > 0
    ? emotions.reduce((a, b) => emoPnl[a]! > emoPnl[b]! ? a : b)
    : null
  const worstEmotion = emotions.length > 0
    ? emotions.reduce((a, b) => emoPnl[a]! < emoPnl[b]! ? a : b)
    : null

  const ruleViolations = trades.filter(t => t.rule_violation === true).length

  const report = await generatePsychologyReport({
    total_trades:      trades.length,
    wins, losses,
    net_pnl:           totalPnl,
    win_rate:          winRate,
    avg_rr:            avgRR,
    max_drawdown:      maxDd,
    rule_violations:   ruleViolations,
    mistake_counts:    mistakeCounts,
    emotion_breakdown: emoCounts,
    best_emotion:      bestEmotion,
    worst_emotion:     worstEmotion,
  })

  if (!report) {
    return NextResponse.json({ error: 'AI report generation failed' }, { status: 502 })
  }

  // Log for rate limiting
  await supabase.from('audit_logs').insert({
    actor_id:    user.id,
    actor_email: user.email,
    action:      'ai.psychology',
    resource_type: 'ai_report',
  }).then(() => {}, () => {})

  return NextResponse.json({ report })
}
