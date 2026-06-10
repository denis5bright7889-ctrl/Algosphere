/**
 * POST /api/admin/shadow-manual-close
 *   { shadow_id: <uuid>, exit_price: <number> }
 *
 * Admin escape hatch for closing a stuck shadow position at a
 * specified exit price. Computes PnL the same way the lifecycle
 * ticker would.
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { isAdmin } from '@/lib/admin'
import { manualCloseShadow } from '@/lib/intelligence/shadow-execution-engine'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const schema = z.object({
  shadow_id:  z.string().uuid(),
  exit_price: z.number().positive(),
})

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !isAdmin(user.email)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const body = await request.json().catch(() => ({}))
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input', details: parsed.error.format() }, { status: 422 })
  }
  const result = await manualCloseShadow(parsed.data.shadow_id, parsed.data.exit_price)
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 400 })
  }
  return NextResponse.json({ ok: true })
}
