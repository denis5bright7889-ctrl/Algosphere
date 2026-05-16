import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'

const FIRM_PRESETS: Record<string, { profit: number; daily: number; total: number; minDays: number; maxDays: number }> = {
  FTMO:        { profit: 10, daily: 5, total: 10, minDays: 4, maxDays: 30 },
  TheFundedTrader: { profit: 8, daily: 5, total: 12, minDays: 0, maxDays: 30 },
  MyForexFunds:    { profit: 8, daily: 5, total: 12, minDays: 0, maxDays: 30 },
  Apex:        { profit: 6, daily: 3, total: 6,  minDays: 0, maxDays: 30 },
  'The5ers':   { profit: 6, daily: 4, total: 5,  minDays: 0, maxDays: 0  },
  Other:       { profit: 10, daily: 5, total: 10, minDays: 4, maxDays: 30 },
}

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('prop_challenges')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: 'Failed' }, { status: 500 })
  return NextResponse.json({ challenges: data ?? [], firm_presets: FIRM_PRESETS })
}

const createSchema = z.object({
  firm_name:         z.string().min(2).max(60),
  account_size_usd:  z.number().positive(),
  phase:             z.enum(['challenge','verification','funded']).default('challenge'),
  profit_target_pct: z.number().min(0).max(100).optional(),
  max_daily_loss_pct: z.number().min(0).max(100).optional(),
  max_total_loss_pct: z.number().min(0).max(100).optional(),
  min_trading_days:  z.number().int().min(0).max(60).optional(),
  max_trading_days:  z.number().int().min(0).max(365).optional(),
  mt5_account_id:    z.string().max(40).optional(),
})

export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body   = await req.json().catch(() => null)
  const parsed = createSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid input' }, { status: 422 })

  const d = parsed.data
  const preset = FIRM_PRESETS[d.firm_name] ?? FIRM_PRESETS.Other!

  const { data, error } = await supabase
    .from('prop_challenges')
    .insert({
      user_id:               user.id,
      firm_name:             d.firm_name,
      account_size_usd:      d.account_size_usd,
      phase:                 d.phase,
      profit_target_pct:     d.profit_target_pct  ?? preset.profit,
      max_daily_loss_pct:    d.max_daily_loss_pct ?? preset.daily,
      max_total_loss_pct:    d.max_total_loss_pct ?? preset.total,
      min_trading_days:      d.min_trading_days   ?? preset.minDays,
      max_trading_days:      d.max_trading_days   ?? preset.maxDays,
      current_balance_usd:   d.account_size_usd,
      highest_balance_usd:   d.account_size_usd,
      mt5_account_id:        d.mt5_account_id,
      status:                'active',
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: 'Failed to create' }, { status: 500 })
  return NextResponse.json({ challenge: data }, { status: 201 })
}
