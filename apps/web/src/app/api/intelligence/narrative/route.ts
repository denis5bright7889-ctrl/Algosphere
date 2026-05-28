/**
 * /api/intelligence/narrative — institutional theme tracker.
 *
 * Returns the NarrativeBoard (see lib/narrative-engine.ts) — per-theme
 * strength / acceleration / fatigue / institutional participation /
 * crowding, plus a top-of-page composed headline.
 */
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { composeNarrativeBoard } from '@/lib/narrative-engine'

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

  try {
    const board = await composeNarrativeBoard({ window: win })
    return NextResponse.json({ ...board, window: win })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Narrative compose failed' },
      { status: 502 },
    )
  }
}
