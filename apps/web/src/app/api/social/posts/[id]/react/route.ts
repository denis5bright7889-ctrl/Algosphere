import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'

const schema = z.object({
  reaction: z.enum(['like','bullish','bearish','insightful','fire']).default('like'),
})

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body   = await req.json().catch(() => ({}))
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid reaction' }, { status: 422 })
  }

  const { data, error } = await supabase.rpc('react_to_post', {
    p_post_id:  id,
    p_reaction: parsed.data.reaction,
  })

  if (error) {
    console.error('react error:', error)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
  return NextResponse.json(data)
}
