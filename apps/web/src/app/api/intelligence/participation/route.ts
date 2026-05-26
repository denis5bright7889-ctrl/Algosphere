/**
 * /api/intelligence/participation — who is driving price (per-asset).
 *
 * Returns the participation board (top-N tokens by smart-money buy volume)
 * with per-channel breakdown (Smart Money / Whales / Aggression; Retail
 * shown honestly as Awaiting Data until exchange aggregates are wired).
 *
 *   GET /api/intelligence/participation?window=24h&limit=20
 */
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { composeParticipationBoard } from '@/lib/participation-engine'

export const dynamic = 'force-dynamic'

type WindowParam = '1h' | '24h' | '7d' | '30d'
const VALID: WindowParam[] = ['1h', '24h', '7d', '30d']

export async function GET(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sp = new URL(req.url).searchParams
  const windowRaw = sp.get('window') ?? '24h'
  const win: WindowParam = (VALID as string[]).includes(windowRaw) ? (windowRaw as WindowParam) : '24h'
  const limit = Math.max(4, Math.min(48, parseInt(sp.get('limit') ?? '24', 10) || 24))

  try {
    const board = await composeParticipationBoard({ window: win, limit })
    return NextResponse.json({ ...board, window: win, generated_at: new Date().toISOString() })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Participation compose failed' },
      { status: 502 },
    )
  }
}
