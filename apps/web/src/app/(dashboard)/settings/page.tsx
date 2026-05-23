import {
  User, Wallet, Eye, Send, ShieldCheck, Bell, PlugZap, KeyRound,
  Crown, MonitorSmartphone, ScrollText, Receipt, Lock,
  type LucideIcon,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { formatDate } from '@/lib/utils'
import AccountForm from './AccountForm'
import TelegramLinkForm from './TelegramLinkForm'
import PublicProfileForm from './PublicProfileForm'
import QuickLink from './QuickLink'
import SignOutEverywhereButton from './SignOutEverywhereButton'

export const metadata = { title: 'Settings' }
export const dynamic = 'force-dynamic'

type Sb = Awaited<ReturnType<typeof createClient>>

/** Merged stream of recent account events from real tables. */
async function loadActivity(sb: Sb, userId: string): Promise<ActivityItem[]> {
  const [{ data: payments }, { data: brokers }, { data: notifs }] = await Promise.all([
    sb.from('crypto_payments')
      .select('id, plan, amount_usd, status, created_at, reviewed_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(8),
    sb.from('broker_connections')
      .select('broker, status, is_testnet, created_at, updated_at')
      .eq('user_id', userId)
      .order('updated_at', { ascending: false })
      .limit(8),
    sb.from('social_notifications')
      .select('notif_type, message, created_at')
      .eq('recipient_id', userId)
      .order('created_at', { ascending: false })
      .limit(15),
  ])

  const out: ActivityItem[] = []

  for (const p of payments ?? []) {
    out.push({
      when:  p.created_at,
      icon:  Receipt,
      title: `Payment ${p.status.replace('_', ' ')}`,
      detail: `${p.plan} plan · $${Number(p.amount_usd).toFixed(2)}`,
    })
  }
  for (const b of brokers ?? []) {
    out.push({
      when:  b.updated_at ?? b.created_at,
      icon:  PlugZap,
      title: `Broker ${b.broker} — ${b.status}`,
      detail: b.is_testnet ? 'Testnet' : 'Live',
    })
  }
  for (const n of notifs ?? []) {
    out.push({
      when:  n.created_at,
      icon:  Bell,
      title: 'Notification',
      detail: n.message?.slice(0, 90) ?? n.notif_type,
    })
  }

  return out
    .sort((a, b) => new Date(b.when).getTime() - new Date(a.when).getTime())
    .slice(0, 20)
}

interface ActivityItem {
  when:   string
  icon:   LucideIcon
  title:  string
  detail: string
}

export default async function SettingsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const [
    { data: profile }, { data: subscription }, { data: pushDevices }, { data: payments }, activity, { data: factors },
  ] = await Promise.all([
    supabase.from('profiles')
      .select('full_name, telegram_chat_id, whatsapp_number, subscription_tier, subscription_status, created_at, public_profile, public_handle, bio')
      .eq('id', user!.id)
      .single(),
    supabase.from('subscriptions')
      .select('plan, status, current_period_end, cancel_at_period_end')
      .eq('user_id', user!.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase.from('push_subscriptions')
      .select('id, user_agent, created_at, last_sent_at')
      .eq('user_id', user!.id)
      .order('created_at', { ascending: false }),
    supabase.from('crypto_payments')
      .select('id, plan, amount_usd, status, network, txid, created_at')
      .eq('user_id', user!.id)
      .order('created_at', { ascending: false })
      .limit(20),
    loadActivity(supabase, user!.id),
    supabase.auth.mfa.listFactors(),
  ])

  const totpEnabled = (factors?.totp ?? []).some((f) => f.status === 'verified')

  const tier = profile?.subscription_tier ?? 'free'

  return (
    <div className="mx-auto max-w-5xl space-y-6 animate-fade-in">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {user!.email} · joined {formatDate(profile?.created_at ?? '')}
        </p>
      </header>

      {/* Quick-link grid — every settings surface, one tap away */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <QuickLink href="/profile/edit" icon={User}        title="Public Profile" description="Trader handle, bio, leaderboard opt-in" />
        <QuickLink href="/upgrade"      icon={Crown}       title="Subscription"   description={`${tier} plan · ${profile?.subscription_status ?? 'inactive'}`} />
        <QuickLink href="/alerts"       icon={Bell}        title="Notifications"  description="Channels, per-category buckets, devices" />
        <QuickLink href="/brokers"      icon={PlugZap}     title="Connected Brokers" description="Binance / Bybit / OKX / MT5 — vault" />
        <QuickLink href="/api-keys"     icon={KeyRound}    title="API Access"     description="Developer keys, rate limits, metering" />
        <QuickLink href="#security"     icon={ShieldCheck} title="Security"       description="Sessions, 2FA, sign out" />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {/* Profile */}
          <Section icon={User} title="Profile">
            <AccountForm userId={user!.id} initialName={profile?.full_name ?? ''} />
          </Section>

          {/* Public profile / leaderboard */}
          <Section icon={Eye} title="Public Profile" hint="Showcase verified journal stats on the leaderboard.">
            <PublicProfileForm
              initialEnabled={profile?.public_profile ?? false}
              initialHandle={profile?.public_handle ?? ''}
              initialBio={profile?.bio ?? ''}
            />
          </Section>

          {/* Telegram */}
          <Section icon={Send} title="Telegram Bot" hint="Receive signals and account alerts in Telegram.">
            <TelegramLinkForm userId={user!.id} currentChatId={profile?.telegram_chat_id ?? null} />
            <div className="mt-3 rounded-lg bg-muted/40 p-3 text-xs text-muted-foreground space-y-1">
              <p className="font-medium text-foreground">How to find your Telegram Chat ID:</p>
              <ol className="list-decimal list-inside space-y-0.5">
                <li>Open Telegram and message <strong>@userinfobot</strong></li>
                <li>It replies with your numeric user ID</li>
                <li>Paste that number above and save</li>
                <li>Then start our bot and send <strong>/start</strong></li>
              </ol>
            </div>
          </Section>

          {/* Billing summary + history */}
          <Section icon={Wallet} title="Billing & Subscription">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium capitalize">
                  {tier} plan
                  <span className="ml-2 text-muted-foreground capitalize">({profile?.subscription_status ?? 'inactive'})</span>
                </p>
                {subscription?.current_period_end && (
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {subscription.cancel_at_period_end
                      ? `Access until ${formatDate(subscription.current_period_end)}`
                      : subscription.status === 'trialing'
                      ? `Trial ends ${formatDate(subscription.current_period_end)}`
                      : `Renews ${formatDate(subscription.current_period_end)}`}
                  </p>
                )}
              </div>
              <a href="/upgrade" className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90">
                {tier !== 'free' ? 'Renew' : 'Upgrade'}
              </a>
            </div>

            {payments && payments.length > 0 ? (
              <div className="mt-4 overflow-x-auto rounded-lg border border-border/60">
                <table className="w-full min-w-[520px] text-xs">
                  <thead className="bg-muted/30 text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium">Date</th>
                      <th className="px-3 py-2 text-left font-medium">Plan</th>
                      <th className="px-3 py-2 text-right font-medium">Amount</th>
                      <th className="px-3 py-2 text-left font-medium">Network</th>
                      <th className="px-3 py-2 text-left font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payments.map((p) => (
                      <tr key={p.id} className="border-t border-border/40">
                        <td className="px-3 py-2 text-muted-foreground">
                          {new Date(p.created_at).toLocaleDateString()}
                        </td>
                        <td className="px-3 py-2 capitalize">{p.plan}</td>
                        <td className="px-3 py-2 text-right tabular-nums font-semibold">
                          ${Number(p.amount_usd).toFixed(2)}
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">{p.network}</td>
                        <td className="px-3 py-2">
                          <span className={
                            'rounded-full px-2 py-0.5 text-[10px] font-bold capitalize ' +
                            (p.status === 'approved'         ? 'bg-emerald-500/15 text-emerald-300'
                              : p.status === 'rejected'      ? 'bg-rose-500/15 text-rose-300'
                              : p.status === 'expired'       ? 'bg-muted/40 text-muted-foreground'
                              : 'bg-amber-500/15 text-amber-300')
                          }>
                            {p.status.replace('_', ' ')}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="mt-4 text-xs text-muted-foreground">No payments on file yet.</p>
            )}
          </Section>

          {/* Activity log */}
          <Section icon={ScrollText} title="Recent Activity" hint="Derived from your real payments, broker connections and notifications.">
            {activity.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing here yet.</p>
            ) : (
              <ul className="divide-y divide-border/40">
                {activity.map((a, i) => {
                  const Icon = a.icon
                  return (
                    <li key={i} className="flex items-start gap-3 py-2.5">
                      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-amber-300/80" strokeWidth={1.75} aria-hidden />
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-medium">{a.title}</p>
                        <p className="text-[11px] text-muted-foreground truncate">{a.detail}</p>
                      </div>
                      <span className="shrink-0 text-[10px] text-muted-foreground">
                        {new Date(a.when).toLocaleDateString()}
                      </span>
                    </li>
                  )
                })}
              </ul>
            )}
          </Section>
        </div>

        {/* Right rail — security & devices */}
        <div className="space-y-6">
          <Section id="security" icon={ShieldCheck} title="Security">
            <div className="space-y-4">
              <div>
                <p className="text-sm font-semibold">Password</p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  Reset via your email by signing out and using &ldquo;Forgot password&rdquo; on login.
                </p>
              </div>

              <div>
                <p className="flex items-center gap-1.5 text-sm font-semibold">
                  <Lock className="h-3.5 w-3.5 text-muted-foreground" strokeWidth={1.75} aria-hidden />
                  Two-factor authentication
                  <span className={
                    'ml-1 rounded-full border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider ' +
                    (totpEnabled
                      ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                      : 'border-amber-500/30 bg-amber-500/10 text-amber-300')
                  }>
                    {totpEnabled ? 'On' : 'Off'}
                  </span>
                </p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  {totpEnabled
                    ? 'Authenticator-app code required at sign-in.'
                    : 'Add a TOTP authenticator (Google Authenticator / 1Password / Authy) to your sign-in.'}
                </p>
                <a
                  href="/settings/2fa"
                  className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-amber-300 hover:underline"
                >
                  {totpEnabled ? 'Manage 2FA' : 'Set up 2FA'} →
                </a>
              </div>

              <div className="pt-1">
                <SignOutEverywhereButton />
                <p className="mt-2 text-[11px] text-muted-foreground">
                  Revokes every active session across all browsers and devices.
                </p>
              </div>
            </div>
          </Section>

          <Section icon={MonitorSmartphone} title="Push Devices" hint="Browsers + devices receiving Web Push notifications.">
            {!pushDevices || pushDevices.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No devices subscribed. Enable Web Push from <a href="/alerts" className="text-amber-300 hover:underline">Alerts</a>.
              </p>
            ) : (
              <ul className="space-y-2">
                {pushDevices.map((d) => (
                  <li key={d.id} className="rounded-lg border border-border/50 px-3 py-2">
                    <p className="truncate text-xs font-medium">
                      {(d.user_agent ?? 'Unknown device').slice(0, 60)}
                    </p>
                    <p className="mt-0.5 text-[10px] text-muted-foreground">
                      Since {new Date(d.created_at).toLocaleDateString()}
                      {d.last_sent_at && ` · last alert ${new Date(d.last_sent_at).toLocaleDateString()}`}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
      </div>
    </div>
  )
}

function Section({
  id, icon: Icon, title, hint, children,
}: {
  id?:      string
  icon:     LucideIcon
  title:    string
  hint?:    string
  children: React.ReactNode
}) {
  return (
    <section id={id} className="rounded-2xl border border-border/70 glass p-5">
      <header className="mb-3">
        <h2 className="flex items-center gap-2 text-sm font-bold tracking-tight">
          <Icon className="h-4 w-4 text-amber-300/80" strokeWidth={1.75} aria-hidden />
          {title}
        </h2>
        {hint && <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>}
      </header>
      {children}
    </section>
  )
}
