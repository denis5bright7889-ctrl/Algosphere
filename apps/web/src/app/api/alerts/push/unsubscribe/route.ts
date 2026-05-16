import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'

const schema = z.object({ endpoint: z.string().url().max(2048).optional() })

export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body   = await req.json().catch(() => ({}))
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid' }, { status: 422 })

  let query = supabase
    .from('push_subscriptions')
    .delete()
    .eq('user_id', user.id)

  // If a specific endpoint is given → unsubscribe just that device.
  // Otherwise unsubscribe ALL devices for this user.
  if (parsed.data.endpoint) query = query.eq('endpoint', parsed.data.endpoint)

  const { error } = await query
  if (error) return NextResponse.json({ error: 'Failed' }, { status: 500 })

  // If unsubscribing everywhere, also flip the preference off
  if (!parsed.data.endpoint) {
    await supabase
      .from('notification_preferences')
      .upsert({ user_id: user.id, push_enabled: false }, { onConflict: 'user_id' })
  }

  return NextResponse.json({ ok: true })
}
