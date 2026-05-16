/**
 * Internal settlement callback — invoked by the signal-engine's
 * lifecycle_monitor when it auto-closes a signal (TP/SL/expiry).
 *
 * The web app owns the copy-trade settlement + creator profit-share +
 * shadow-drift logic (single-sourced in lib/copy-settlement.ts). Rather
 * than duplicate that in Python, the engine fires this endpoint after a
 * terminal transition.
 *
 * Auth: shared secret in the X-Engine-Key header (same ENGINE_API_KEY
 * the web app uses to call the engine — symmetric trust).
 *
 * Idempotent: settleCopyTradesForSignal only touches copy_trades in
 * pending/mirrored/partial and shadow rows with closed_at IS NULL, so a
 * duplicate call is a no-op.
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient as serviceClient } from '@supabase/supabase-js'
import { settleCopyTradesForSignal } from '@/lib/copy-settlement'

const bodySchema = z.object({
  signal_id: z.string().uuid(),
})

export async function POST(req: NextRequest) {
  const expected = process.env.ENGINE_API_KEY
  if (!expected) {
    return NextResponse.json(
      { error: 'ENGINE_API_KEY not configured on web app' }, { status: 503 },
    )
  }
  if (req.headers.get('x-engine-key') !== expected) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'signal_id (uuid) required' }, { status: 422 })
  }

  const svc = serviceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  try {
    const result = await settleCopyTradesForSignal(svc, parsed.data.signal_id)
    return NextResponse.json({ ok: true, result })
  } catch (e) {
    console.error('internal settle-signal failed:', e)
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    )
  }
}
