import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { sendPushToUser, isPushAvailable } from '@/lib/notify/push'

// Fires a test push to all of the current user's subscriptions.
export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!isPushAvailable()) {
    return NextResponse.json({
      error: 'Web Push not configured. Set VAPID_PUBLIC_KEY + VAPID_PRIVATE_KEY in .env',
    }, { status: 503 })
  }

  const result = await sendPushToUser(user.id, {
    title: '✓ Push notifications working',
    body:  'You\'ll see signals, copy-trade fills, and prop alerts here.',
    url:   '/dashboard/alerts',
    tag:   'test',
  })

  if (result.sent === 0 && result.failed === 0) {
    return NextResponse.json({
      error: 'No active subscriptions. Click "Enable" first.',
    }, { status: 400 })
  }

  return NextResponse.json({ ok: true, ...result })
}
