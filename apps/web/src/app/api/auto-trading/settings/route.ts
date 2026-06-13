/**
 * Auto-trading settings — GET / POST.
 *
 *   GET  /api/auto-trading/settings
 *     Returns the caller's settings (or DEFAULT_SETTINGS if no row).
 *
 *   POST /api/auto-trading/settings
 *     Upsert the caller's settings. Validates ranges + array shapes.
 *     RLS enforces user_id = auth.uid().
 *
 * Auth: session required. No admin gate — every user owns their row.
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { DEFAULT_SETTINGS, SUPPORTED_SYMBOLS, type AutoTradingSettings } from '@/lib/auto-trading'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const symbolSet = new Set<string>(SUPPORTED_SYMBOLS as readonly string[])

const updateSchema = z.object({
  enabled:                z.boolean().optional(),
  allowed_symbols:        z.array(z.string()).max(40).optional(),
  min_confidence:         z.number().int().min(1).max(100).optional(),
  max_risk_pct:           z.number().positive().max(5).optional(),
  max_trades_per_day:     z.number().int().min(1).max(50).optional(),
  allowed_directions:     z.array(z.enum(['buy', 'sell'])).max(2).optional(),
  allowed_brokers:        z.array(z.string()).max(20).optional(),
  require_active_session: z.boolean().optional(),
  paused_until:           z.string().datetime().nullable().optional(),
})

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('user_auto_trading_settings')
    .select('*')
    .eq('user_id', user.id)
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  if (!data) {
    // No row yet — return defaults so the UI renders the same shape.
    return NextResponse.json({
      ok: true,
      settings: {
        user_id:               user.id,
        ...DEFAULT_SETTINGS,
        updated_at:            new Date().toISOString(),
        enabled_at:            null,
        total_auto_executions: 0,
      } satisfies AutoTradingSettings,
      exists: false,
    })
  }

  return NextResponse.json({ ok: true, settings: data, exists: true })
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => ({}))
  const parsed = updateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', details: parsed.error.format() },
      { status: 422 },
    )
  }

  const patch: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(parsed.data)) {
    if (v === undefined) continue
    if (k === 'allowed_symbols' && Array.isArray(v)) {
      // Filter to known symbols only — never persist arbitrary strings
      patch[k] = (v as string[]).filter(s => symbolSet.has(s.toUpperCase())).map(s => s.toUpperCase())
    } else {
      patch[k] = v
    }
  }

  // Defensive: refuse to enable if no symbols allowed (would mean
  // "auto-execute on nothing" — confusing state).
  if (patch.enabled === true) {
    const { data: existing } = await supabase
      .from('user_auto_trading_settings')
      .select('allowed_symbols')
      .eq('user_id', user.id)
      .maybeSingle()
    const nextSymbols = Array.isArray(patch.allowed_symbols)
      ? (patch.allowed_symbols as string[])
      : ((existing?.allowed_symbols as string[] | undefined) ?? [])
    if (nextSymbols.length === 0) {
      return NextResponse.json(
        { error: 'Add at least one allowed symbol before enabling auto-trading' },
        { status: 422 },
      )
    }
  }

  const { data, error } = await supabase
    .from('user_auto_trading_settings')
    .upsert({ user_id: user.id, ...patch }, { onConflict: 'user_id' })
    .select('*')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true, settings: data })
}
