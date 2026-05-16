import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import PushSubscribeButton from '@/components/social/PushSubscribeButton'

export const metadata = { title: 'Alerts & Notifications — AlgoSphere Quant' }
export const dynamic = 'force-dynamic'

export default async function AlertsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: prefs } = await supabase
    .from('notification_preferences')
    .select('*')
    .eq('user_id', user.id)
    .maybeSingle()

  const { data: pushDevices } = await supabase
    .from('push_subscriptions')
    .select('id, user_agent, created_at, last_sent_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })

  const { data: recentLog } = await supabase
    .from('notification_log')
    .select('channel, event_type, subject, status, sent_at')
    .eq('user_id', user.id)
    .order('sent_at', { ascending: false })
    .limit(15)

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">
          Alerts & <span className="text-gradient">Notifications</span>
        </h1>
        <p className="text-xs text-muted-foreground mt-1">
          Push notifications work on every device — phone, laptop, desktop.
          No app install required.
        </p>
      </header>

      {/* Push */}
      <section className="rounded-2xl border border-border bg-card p-6 mb-5">
        <div className="flex items-start justify-between gap-3 flex-wrap mb-4">
          <div>
            <h2 className="text-sm font-bold">📲 Web Push</h2>
            <p className="text-xs text-muted-foreground mt-1">
              Real-time push to this device. Free, instant, works offline-tolerant.
            </p>
          </div>
        </div>
        <PushSubscribeButton />

        {pushDevices && pushDevices.length > 0 && (
          <div className="mt-5 pt-5 border-t border-border/40">
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold mb-2">
              Active devices ({pushDevices.length})
            </p>
            <ul className="space-y-1.5">
              {pushDevices.map(d => (
                <li key={d.id} className="text-[11px] text-muted-foreground flex items-center justify-between">
                  <span className="truncate max-w-[400px]">
                    {d.user_agent ? abbreviateUA(d.user_agent) : 'Unknown device'}
                  </span>
                  <span className="text-[10px] tabular-nums">
                    {d.last_sent_at
                      ? `last alert ${new Date(d.last_sent_at).toLocaleDateString()}`
                      : `added ${new Date(d.created_at).toLocaleDateString()}`}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {/* Email + Telegram + Premium */}
      <section className="rounded-2xl border border-border bg-card p-6 mb-5">
        <h2 className="text-sm font-bold mb-4">📨 Channels</h2>
        <ul className="space-y-3 text-sm">
          <ChannelRow icon="📧" label="Email" enabled={prefs?.email_enabled ?? true}
            note="Trade reviews, payment receipts, weekly digests, prop breaches" />
          <ChannelRow icon="💬" label="Telegram" enabled={prefs?.telegram_enabled ?? true}
            note="Live signals, copy-trade fills, smart-money alerts" />
          <ChannelRow icon="🟢" label="WhatsApp" enabled={prefs?.whatsapp_enabled ?? false}
            note="Available on Pro+ (requires phone verification)" lockedReason="Pro plan" />
          <ChannelRow icon="📱" label="SMS" enabled={prefs?.sms_enabled ?? false}
            note="Urgent alerts only (prop breaches, kill switch)" lockedReason="Pro plan" />
        </ul>
      </section>

      {/* Recent delivery log */}
      <section className="rounded-2xl border border-border bg-card overflow-hidden">
        <h2 className="px-6 py-4 text-sm font-bold border-b border-border">
          📜 Recent deliveries
        </h2>
        {!recentLog || recentLog.length === 0 ? (
          <p className="px-6 py-8 text-center text-xs text-muted-foreground">
            No notifications delivered yet.
          </p>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-[10px] text-muted-foreground uppercase tracking-wider border-b border-border/40">
                <th className="px-4 py-2">When</th>
                <th className="px-4 py-2">Channel</th>
                <th className="px-4 py-2">Event</th>
                <th className="px-4 py-2 text-right">Status</th>
              </tr>
            </thead>
            <tbody>
              {recentLog.map((r, i) => (
                <tr key={i} className="border-b border-border/30 last:border-0">
                  <td className="px-4 py-2 text-muted-foreground tabular-nums">
                    {new Date(r.sent_at).toLocaleString()}
                  </td>
                  <td className="px-4 py-2 capitalize">{r.channel}</td>
                  <td className="px-4 py-2 truncate max-w-[240px]">
                    {r.subject ?? r.event_type}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <span className={
                      r.status === 'sent'    ? 'text-emerald-400' :
                      r.status === 'failed'  ? 'text-rose-400'    :
                      'text-muted-foreground'
                    }>{r.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  )
}

function ChannelRow({ icon, label, enabled, note, lockedReason }: {
  icon: string; label: string; enabled: boolean; note: string; lockedReason?: string
}) {
  return (
    <li className="flex items-start gap-3">
      <span className="text-xl flex-shrink-0">{icon}</span>
      <div className="flex-1 min-w-0">
        <p className="font-semibold">{label}</p>
        <p className="text-[11px] text-muted-foreground">{note}</p>
      </div>
      {lockedReason ? (
        <span className="rounded-full border border-border bg-muted/30 px-2 py-0.5 text-[10px] font-bold text-muted-foreground">
          🔒 {lockedReason}
        </span>
      ) : enabled ? (
        <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-300">
          ✓ On
        </span>
      ) : (
        <span className="rounded-full border border-border bg-muted/30 px-2 py-0.5 text-[10px] font-bold text-muted-foreground">
          Off
        </span>
      )}
    </li>
  )
}

function abbreviateUA(ua: string): string {
  if (/iPhone|iPad/.test(ua))   return '📱 iOS Safari'
  if (/Android/.test(ua))       return '🤖 Android'
  if (/Mac OS X/.test(ua))      return '💻 Mac'
  if (/Windows/.test(ua))       return '🪟 Windows'
  if (/Linux/.test(ua))         return '🐧 Linux'
  return ua.slice(0, 60)
}
