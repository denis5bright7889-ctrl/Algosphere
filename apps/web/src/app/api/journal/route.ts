import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { z } from 'zod'

const journalEntrySchema = z.object({
  pair: z.string().min(1),
  direction: z.enum(['buy', 'sell']),
  entry_price: z.number().optional(),
  exit_price: z.number().optional(),
  lot_size: z.number().positive().optional(),
  pips: z.number().optional(),
  pnl: z.number().optional(),
  risk_amount: z.number().positive().optional(),
  setup_tag: z.string().optional(),
  notes: z.string().optional(),
  screenshot_url: z.string().url().optional(),
  trade_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
})

export async function GET(_request: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data, error } = await supabase
    .from('journal_entries')
    .select('*')
    .eq('user_id', user.id)
    .order('trade_date', { ascending: false })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ data })
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json()
  const parsed = journalEntrySchema.safeParse(body)

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 })
  }

  const { data, error } = await supabase
    .from('journal_entries')
    .insert({ ...parsed.data, user_id: user.id })
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ data }, { status: 201 })
}
