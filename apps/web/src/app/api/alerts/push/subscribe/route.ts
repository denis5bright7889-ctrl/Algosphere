import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'

const schema = z.object({
  endpoint: z.string().url().max(2048),
  keys: z.object({
    p256dh: z.string().min(20).max(200),
    auth:   z.string().min(8).max(100),
  }),
})

export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body   = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid push subscription' }, { status: 422 })
  }

  const ua = req.headers.get('user-agent')?.slice(0, 200)

  // Upsert by (user_id, endpoint) — same browser re-subscribing should not create dupes
  const { error: upErr } = await supabase
    .from('push_subscriptions')
    .upsert({
      user_id:      user.id,
      endpoint:     parsed.data.endpoint,
      p256dh_key:   parsed.data.keys.p256dh,
      auth_key:     parsed.data.keys.auth,
      user_agent:   ua,
      failed_count: 0,
    }, { onConflict: 'user_id,endpoint' })

  if (upErr) {
    console.error('push subscribe error:', upErr)
    return NextResponse.json({ error: 'Failed to subscribe' }, { status: 500 })
  }

  // Enable the push channel in preferences
  await supabase
    .from('notification_preferences')
    .upsert({ user_id: user.id, push_enabled: true }, { onConflict: 'user_id' })

  return NextResponse.json({ ok: true })
}
