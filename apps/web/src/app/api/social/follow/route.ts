import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'

const schema = z.object({ leader_id: z.string().uuid() })

export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid leader_id' }, { status: 422 })

  const { data, error } = await supabase.rpc('toggle_follow', {
    p_leader_id: parsed.data.leader_id,
  })

  if (error) {
    const msg = error.message.toLowerCase()
    if (msg.includes('yourself')) return NextResponse.json({ error: 'Cannot follow yourself' }, { status: 400 })
    console.error('toggle_follow error:', error)
    return NextResponse.json({ error: 'Failed to update follow' }, { status: 500 })
  }

  return NextResponse.json(data)
}

export async function GET(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const leaderId = searchParams.get('leader_id')
  if (!leaderId) return NextResponse.json({ error: 'leader_id required' }, { status: 400 })

  const { data } = await supabase.rpc('is_following', { p_leader_id: leaderId })
  return NextResponse.json({ following: data ?? false })
}
