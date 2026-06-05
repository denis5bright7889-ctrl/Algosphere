/**
 * GET /api/admin/signals/symbol-coverage — master-prompt layer 6.
 *
 * Real-data symbol coverage: which configured symbols are firing, which are
 * silently dead, and why. Joins three real sources — the configured universe
 * (engine /status), per-symbol decisions (system_event_log), and the last
 * regime scan per symbol (regime_snapshots) — through the pure analyzer.
 * Admin-only. No fabrication: untracked symbols are reported as `never`.
 */
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as serviceClient } from '@supabase/supabase-js'
import { isAdmin } from '@/lib/admin'
import { getEngineStatus } from '@/lib/engine-client'
import { analyzeSymbolCoverage, type SymbolEvent } from '@/lib/intelligence/symbol-coverage'

export const dynamic = 'force-dynamic'

const HISTORY_DAYS = 30
const WINDOW_DAYS  = 7
const DECISION_SURFACES = ['signal_generated', 'signal_rejected', 'signal_skipped', 'risk_block']

function svc() {
  return serviceClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !isAdmin(user.email)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const db = svc()
  const now = Date.now()
  const since = (d: number) => new Date(now - d * 86_400_000).toISOString()

  // 1. Configured universe — authoritative from the engine. Fall back to
  //    whatever symbols appear in telemetry if the engine is unreachable.
  const status = await getEngineStatus()
  let universe: string[] = status.ok ? (status.data.symbols ?? []) : []

  // 2. Per-symbol decision events.
  const { data: evRows, error: evErr } = await db
    .from('system_event_log')
    .select('surface, payload_summary, sent_at')
    .in('surface', DECISION_SURFACES)
    .gte('sent_at', since(HISTORY_DAYS))
    .order('sent_at', { ascending: false })
    .limit(8000)
  if (evErr) return NextResponse.json({ ok: false, error: evErr.message }, { status: 500 })

  const events: SymbolEvent[] = (evRows ?? []).map((r) => {
    const p = (r.payload_summary ?? {}) as { symbol?: string; reason?: string }
    return { surface: r.surface as string, symbol: p.symbol ?? '', reason: p.reason ?? null, at: r.sent_at as string }
  }).filter((e) => e.symbol)

  // 3. Last regime scan per symbol (proves the data feed is alive).
  const { data: rgRows } = await db
    .from('regime_snapshots')
    .select('symbol, scanned_at')
    .gte('scanned_at', since(2))
    .order('scanned_at', { ascending: false })
    .limit(8000)
  const lastScanBySymbol: Record<string, string> = {}
  for (const r of rgRows ?? []) {
    const s = (r.symbol as string)?.toUpperCase()
    if (s && !lastScanBySymbol[s]) lastScanBySymbol[s] = r.scanned_at as string
  }

  // If the engine was unreachable, derive the universe from telemetry so the
  // report is still real (just possibly missing never-scanned symbols).
  if (universe.length === 0) {
    universe = [...new Set([...events.map((e) => e.symbol.toUpperCase()), ...Object.keys(lastScanBySymbol)])]
  }

  const report = analyzeSymbolCoverage({ universe, events, lastScanBySymbol, now, windowDays: WINDOW_DAYS })
  return NextResponse.json({ ok: true, engine_reachable: status.ok, ...report })
}
