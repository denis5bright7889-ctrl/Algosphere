/**
 * AlgoSphere Quant — Server-side Web Push delivery.
 *
 * Uses `web-push` (VAPID, free). Per-subscription failure counters auto-prune
 * dead subscriptions after 3 consecutive failures (HTTP 404/410 = device
 * unsubscribed → immediately delete).
 */

import webpush from 'web-push'
import { createServiceClient } from '@/lib/supabase/server'

const PUB     = process.env.VAPID_PUBLIC_KEY
const PRIV    = process.env.VAPID_PRIVATE_KEY
const SUBJECT = process.env.VAPID_SUBJECT ?? 'mailto:admin@algosphere.local'

let configured = false
function configure(): boolean {
  if (configured) return true
  if (!PUB || !PRIV) return false
  webpush.setVapidDetails(SUBJECT, PUB, PRIV)
  configured = true
  return true
}

export function isPushAvailable(): boolean {
  return !!(PUB && PRIV)
}

export interface PushPayload {
  title: string
  body:  string
  url?:  string
  tag?:  string
  urgent?: boolean
}

interface PushSubRow {
  id:         string
  endpoint:   string
  p256dh_key: string
  auth_key:   string
  failed_count: number
}

/**
 * Push to every active subscription a user has. Idempotent — pruning happens
 * automatically when devices unsubscribe at the OS/browser level.
 */
export async function sendPushToUser(
  userId: string,
  payload: PushPayload,
): Promise<{ sent: number; failed: number; pruned: number }> {
  if (!configure()) return { sent: 0, failed: 0, pruned: 0 }

  const svc = createServiceClient()
  const { data: subs } = await svc
    .from('push_subscriptions')
    .select('id, endpoint, p256dh_key, auth_key, failed_count')
    .eq('user_id', userId)

  if (!subs || subs.length === 0) return { sent: 0, failed: 0, pruned: 0 }

  const result = { sent: 0, failed: 0, pruned: 0 }
  const body = JSON.stringify(payload)

  await Promise.all((subs as PushSubRow[]).map(async (s) => {
    try {
      await webpush.sendNotification(
        {
          endpoint: s.endpoint,
          keys: { p256dh: s.p256dh_key, auth: s.auth_key },
        },
        body,
        { TTL: 60 * 60 * 24 },   // 24h max queue
      )
      result.sent += 1
      // Reset failure counter + record send
      await svc
        .from('push_subscriptions')
        .update({ failed_count: 0, last_sent_at: new Date().toISOString() })
        .eq('id', s.id)
    } catch (err) {
      const statusCode = (err as { statusCode?: number })?.statusCode
      // 404/410 = subscription expired or unsubscribed → delete immediately
      if (statusCode === 404 || statusCode === 410) {
        await svc.from('push_subscriptions').delete().eq('id', s.id)
        result.pruned += 1
      } else {
        result.failed += 1
        const newFailed = s.failed_count + 1
        if (newFailed >= 3) {
          await svc.from('push_subscriptions').delete().eq('id', s.id)
          result.pruned += 1
        } else {
          await svc
            .from('push_subscriptions')
            .update({ failed_count: newFailed })
            .eq('id', s.id)
        }
      }
    }
  }))

  // Log a single aggregate entry for this push
  await svc.from('notification_log').insert({
    user_id:    userId,
    channel:    'push',
    event_type: payload.tag ?? 'generic',
    subject:    payload.title,
    body:       payload.body,
    status:     result.sent > 0 ? 'sent' : 'failed',
  }).then(() => {}, () => {})

  return result
}
