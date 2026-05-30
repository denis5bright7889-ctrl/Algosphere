import { redirect } from 'next/navigation'
import {
  Inbox, Mail, MessageCircle, Smartphone, Phone, Lock,
  SlidersHorizontal, ScrollText, Send, ExternalLink,
  CheckCircle2, AlertCircle, Megaphone,
  type LucideIcon,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { cn } from '@/lib/utils'
import PushSubscribeButton from '@/components/social/PushSubscribeButton'
import CategoryPreferences from './CategoryPreferences'

export const metadata = { title: 'Smart Alerts — AlgoSphere Quant' }
export const dynamic = 'force-dynamic'

export default async function AlertsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [{ data: prefs }, { data: pushDevices }, { data: recentLog }, { data: profile }, { data: signalChannels }] = await Promise.all([
    supabase
      .from('notification_preferences')
      .select('*')
      .eq('user_id', user.id)
      .maybeSingle(),
    supabase
      .from('push_subscriptions')
      .select('id, user_agent, created_at, last_sent_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false }),
    supabase
      .from('notification_log')
      .select('channel, event_type, subject, status, sent_at')
      .eq('user_id', user.id)
      .order('sent_at', { ascending: false })
      .limit(15),
    supabase
      .from('profiles')
      .select('telegram_chat_id')
      .eq('id', user.id)
      .single(),
    // Top signal channels from the curated directory — what users
    // typically want to find when they look for "the channel where
    // signals are sent".
    supabase
      .from('telegram_communities')
      .select('id, name, description, telegram_url, kind, is_featured, member_count')
      .is('archived_at', null)
      .eq('category', 'signals')
      .order('is_featured', { ascending: false })
      .order('member_count', { ascending: false, nullsFirst: false })
      .limit(3),
  ])

  return (
    <div className="mx-auto max-w-3xl px-1 py-4 sm:px-4 sm:py-6">
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">
          Smart <span className="text-gradient">Alerts</span>
        </h1>
        <p className="text-xs text-muted-foreground mt-1">
          Route AI insights — coach evaluations, regime flips, risk breaches,
          trade closes — to push, email, or Telegram. No app install required.
        </p>
      </header>

      {/* Push */}
      <section className="rounded-2xl border border-border bg-card p-6 mb-5">
        <div className="flex items-start justify-between gap-3 flex-wrap mb-4">
          <div>
            <h2 className="text-sm font-bold">Web Push</h2>
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

      {/* Telegram — bot connection + signal channels */}
      <section className="rounded-2xl border border-border bg-card p-6 mb-5">
        <div className="flex items-start justify-between gap-3 flex-wrap mb-4">
          <div className="flex items-center gap-2">
            <Send className="h-4 w-4 text-amber-300" strokeWidth={1.75} aria-hidden />
            <h2 className="text-sm font-bold">Telegram</h2>
          </div>
          <span className={cn(
            'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider',
            profile?.telegram_chat_id
              ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
              : 'border-amber-500/40 bg-amber-500/10 text-amber-300',
          )}>
            {profile?.telegram_chat_id ? (
              <><CheckCircle2 className="h-3 w-3" strokeWidth={2} /> Connected</>
            ) : (
              <><AlertCircle className="h-3 w-3" strokeWidth={2} /> Not linked</>
            )}
          </span>
        </div>

        {/* Personal bot connection */}
        <div className="rounded-lg border border-border/40 bg-background/40 p-3.5">
          <h3 className="text-xs font-semibold">Personal bot</h3>
          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
            {profile?.telegram_chat_id
              ? 'Your AlgoSphere bot is linked. Trade-close notifications, coach evaluations, regime flips and risk breaches route here automatically.'
              : 'Link the AlgoSphere bot to your Telegram so personal alerts (trade closes, coach evaluations, risk breaches) arrive in your DM. Setup takes about 30 seconds.'}
          </p>
          <a
            href="/settings"
            className="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold text-amber-300 hover:underline"
          >
            {profile?.telegram_chat_id ? 'Manage bot link' : 'Link bot in Settings'}
            <ExternalLink className="h-3 w-3" strokeWidth={2} aria-hidden />
          </a>
        </div>

        {/* Curated signal channels */}
        {(signalChannels?.length ?? 0) > 0 && (
          <div className="mt-3 rounded-lg border border-border/40 bg-background/40 p-3.5">
            <div className="flex items-center justify-between gap-2 mb-2">
              <h3 className="flex items-center gap-1.5 text-xs font-semibold">
                <Megaphone className="h-3 w-3 text-amber-300" strokeWidth={2} aria-hidden />
                Signal channels
              </h3>
              <a href="/communities" className="text-[10px] font-semibold text-amber-300 hover:underline">
                See all →
              </a>
            </div>
            <p className="text-[11px] leading-relaxed text-muted-foreground mb-2.5">
              Curated Telegram channels where engine-emitted signals are published. Tap to open on Telegram.
            </p>
            <ul className="space-y-1.5">
              {(signalChannels ?? []).map((ch) => (
                <li key={ch.id}>
                  <a
                    href={ch.telegram_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-between gap-2 rounded-md border border-border/40 bg-card px-3 py-2 text-[12px] transition hover:border-amber-500/40 hover:bg-amber-500/[0.04]"
                  >
                    <span className="min-w-0 flex-1 truncate font-semibold">{ch.name}</span>
                    {typeof ch.member_count === 'number' && ch.member_count > 0 && (
                      <span className="shrink-0 text-[10px] text-muted-foreground tabular-nums">
                        {formatCount(ch.member_count)} members
                      </span>
                    )}
                    <ExternalLink className="h-3 w-3 shrink-0 text-amber-300" strokeWidth={2} aria-hidden />
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {/* Email + Telegram + Premium */}
      <section className="rounded-2xl border border-border bg-card p-6 mb-5">
        <h2 className="mb-4 flex items-center gap-2 text-sm font-bold">
          <Inbox className="h-4 w-4 text-amber-300" strokeWidth={1.75} aria-hidden />
          Channels
        </h2>
        <ul className="space-y-3 text-sm">
          <ChannelRow icon={Mail}          label="Email"    enabled={prefs?.email_enabled    ?? true}
            note="Trade reviews, payment receipts, weekly digests, prop breaches" />
          <ChannelRow icon={MessageCircle} label="Telegram" enabled={prefs?.telegram_enabled ?? true}
            note="Live signals, copy-trade fills, smart-money alerts" />
          <ChannelRow icon={Smartphone}    label="WhatsApp" enabled={prefs?.whatsapp_enabled ?? false}
            note="Available on Pro+ (requires phone verification)" lockedReason="Pro plan" />
          <ChannelRow icon={Phone}         label="SMS"      enabled={prefs?.sms_enabled      ?? false}
            note="Urgent alerts only (prop breaches, kill switch)" lockedReason="Pro plan" />
        </ul>
      </section>

      {/* Per-category preferences */}
      <section className="rounded-2xl border border-border bg-card p-6 mb-5">
        <h2 className="mb-4 flex items-center gap-2 text-sm font-bold">
          <SlidersHorizontal className="h-4 w-4 text-amber-300" strokeWidth={1.75} aria-hidden />
          Categories
        </h2>
        <CategoryPreferences
          initialRouting={(prefs?.routing_rules as Record<string, unknown> | null) ?? null}
        />
      </section>

      {/* Recent delivery log */}
      <section className="rounded-2xl border border-border bg-card overflow-hidden">
        <h2 className="flex items-center gap-2 px-6 py-4 text-sm font-bold border-b border-border">
          <ScrollText className="h-4 w-4 text-amber-300" strokeWidth={1.75} aria-hidden />
          Recent deliveries
        </h2>
        {!recentLog || recentLog.length === 0 ? (
          <p className="px-6 py-8 text-center text-xs text-muted-foreground">
            No notifications delivered yet.
          </p>
        ) : (
          <>
          {/* Mobile: card list */}
          <ul className="space-y-2 p-3 md:hidden">
            {recentLog.map((r, i) => (
              <li key={i} className="rounded-lg border border-border/60 bg-background/60 p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold capitalize">{r.channel}</span>
                  <span className={
                    'text-[10px] font-bold uppercase tracking-wider ' + (
                      r.status === 'sent'    ? 'text-emerald-400' :
                      r.status === 'failed'  ? 'text-rose-400'    :
                      'text-muted-foreground'
                    )
                  }>{r.status}</span>
                </div>
                <p className="mt-1 truncate text-[11px]">
                  {r.subject ?? r.event_type}
                </p>
                <p className="mt-1 text-[10px] text-muted-foreground tabular-nums">
                  {new Date(r.sent_at).toLocaleString()}
                </p>
              </li>
            ))}
          </ul>

          {/* Desktop: table */}
          <table className="hidden md:table w-full text-xs">
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
          </>
        )}
      </section>
    </div>
  )
}

function ChannelRow({ icon: Icon, label, enabled, note, lockedReason }: {
  icon: LucideIcon; label: string; enabled: boolean; note: string; lockedReason?: string
}) {
  return (
    <li className="flex items-start gap-3">
      <Icon className="h-5 w-5 shrink-0 text-muted-foreground" strokeWidth={1.75} aria-hidden />
      <div className="flex-1 min-w-0">
        <p className="font-semibold">{label}</p>
        <p className="text-[11px] text-muted-foreground">{note}</p>
      </div>
      {lockedReason ? (
        <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/30 px-2 py-0.5 text-[10px] font-bold text-muted-foreground">
          <Lock className="h-2.5 w-2.5" strokeWidth={2} aria-hidden />
          {lockedReason}
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
  if (/iPhone|iPad/.test(ua))   return 'iOS Safari'
  if (/Android/.test(ua))       return 'Android'
  if (/Mac OS X/.test(ua))      return 'macOS'
  if (/Windows/.test(ua))       return 'Windows'
  if (/Linux/.test(ua))         return 'Linux'
  return ua.slice(0, 60)
}

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}
