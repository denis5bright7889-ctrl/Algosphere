/**
 * GET /api/admin/signals/quality — V3 Upgrade 5 (Signal Quality Engine).
 *
 * Ranks symbols / regimes / confidence bands by REAL closed-signal win rate
 * + acceptance rate (signals.result + system_event_log decisions). Admin-only.
 * pnl_available=false until real fills populate PnL — never fabricated.
 */
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as serviceClient } from '@supabase/supabase-js'
import { isAdmin } from '@/lib/admin'
import { analyzeSignalQuality, type QSignal, type QDecision } from '@/lib/intelligence/signal-quality'

export const dynamic = 'force-dynamic'

function svc() {
  return serviceClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !isAdmin(user.email)) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  const db = svc()
  const cutoff = new Date(Date.now() - 30 * 86_400_000).toISOString()

  const [{ data: sigRows, error: sErr }, { data: evRows, error: eErr }] = await Promise.all([
    db.from('signals').select('pair, result, regime, confidence_score, published_at')
      .order('published_at', { ascending: false }).limit(1000),
    db.from('system_event_log').select('surface, payload_summary')
      .in('surface', ['signal_generated', 'signal_rejected', 'signal_skipped'])
      .gte('sent_at', cutoff).limit(8000),
  ])
  if (sErr) return NextResponse.json({ ok: false, error: sErr.message }, { status: 500 })
  if (eErr) return NextResponse.json({ ok: false, error: eErr.message }, { status: 500 })

  const signals: QSignal[] = (sigRows ?? []).map((r) => ({
    pair: (r.pair as string) ?? '', result: (r.result as QSignal['result']) ?? null,
    regime: (r.regime as string) ?? null, confidence_score: (r.confidence_score as number) ?? null,
  }))

  const dec = new Map<string, QDecision>()
  for (const r of evRows ?? []) {
    const sym = ((r.payload_summary ?? {}) as { symbol?: string }).symbol?.toUpperCase()
    if (!sym) continue
    let d = dec.get(sym); if (!d) { d = { symbol: sym, generated: 0, rejected: 0, skipped: 0 }; dec.set(sym, d) }
    if (r.surface === 'signal_generated') d.generated++
    else if (r.surface === 'signal_rejected') d.rejected++
    else if (r.surface === 'signal_skipped') d.skipped++
  }

  return NextResponse.json({ ok: true, ...analyzeSignalQuality({ signals, decisions: [...dec.values()] }) })
}
