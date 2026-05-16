import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'

const schema = z.object({
  target_type: z.enum(['thread', 'reply']),
  target_id:   z.string().uuid(),
  vote:        z.number().int().min(-1).max(1),   // -1 | 0 | 1
})

export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body   = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input' }, { status: 422 })
  }

  const { data, error } = await supabase.rpc('cast_vote', {
    p_target_type: parsed.data.target_type,
    p_target_id:   parsed.data.target_id,
    p_vote:        parsed.data.vote,
  })

  if (error) {
    console.error('vote error:', error)
    return NextResponse.json({ error: 'Failed to vote' }, { status: 500 })
  }
  return NextResponse.json(data)
}
