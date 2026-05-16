import { createClient } from '@/lib/supabase/server'
import AccountForm from './AccountForm'
import TelegramLinkForm from './TelegramLinkForm'
import PublicProfileForm from './PublicProfileForm'
import { formatDate } from '@/lib/utils'

export const metadata = { title: 'Settings' }

export default async function SettingsPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name, telegram_chat_id, whatsapp_number, subscription_tier, subscription_status, stripe_customer_id, created_at, public_profile, public_handle, bio')
    .eq('id', user!.id)
    .single()

  const { data: subscription } = await supabase
    .from('subscriptions')
    .select('plan, status, current_period_end, cancel_at_period_end')
    .eq('user_id', user!.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-2xl font-bold">Settings</h1>

      {/* Account */}
      <section className="rounded-xl border border-border bg-card p-5 space-y-4">
        <h2 className="font-semibold">Account</h2>
        <div className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground">{user!.email}</span>
          <span className="ml-2">· Joined {formatDate(profile?.created_at ?? '')}</span>
        </div>
        <AccountForm
          userId={user!.id}
          initialName={profile?.full_name ?? ''}
        />
      </section>

      {/* Billing */}
      <section className="rounded-xl border border-border bg-card p-5 space-y-4">
        <h2 className="font-semibold">Billing</h2>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium capitalize">
              {profile?.subscription_tier ?? 'free'} plan
              {' · '}
              <span className="text-muted-foreground capitalize">{profile?.subscription_status ?? 'inactive'}</span>
            </p>
            {subscription && (
              <p className="text-xs text-muted-foreground mt-0.5">
                {subscription.cancel_at_period_end
                  ? `Access until ${formatDate(subscription.current_period_end)}`
                  : subscription.status === 'trialing'
                  ? `Trial ends ${formatDate(subscription.current_period_end)}`
                  : `Renews ${formatDate(subscription.current_period_end)}`}
              </p>
            )}
          </div>
          {/* Billing is crypto-only — every renewal goes through /upgrade. */}
          <a
            href="/upgrade"
            className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
          >
            {profile?.subscription_tier && profile.subscription_tier !== 'free' ? 'Renew' : 'Upgrade'}
          </a>
        </div>
      </section>

      {/* Public profile / leaderboard */}
      <section className="rounded-xl border border-border bg-card p-5 space-y-4">
        <div>
          <h2 className="font-semibold">Public Profile &amp; Leaderboard</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Opt in to showcase verified journal stats and rank on the public leaderboard.
          </p>
        </div>
        <PublicProfileForm
          initialEnabled={profile?.public_profile ?? false}
          initialHandle={profile?.public_handle ?? ''}
          initialBio={profile?.bio ?? ''}
        />
      </section>

      {/* Telegram */}
      <section className="rounded-xl border border-border bg-card p-5 space-y-4">
        <div>
          <h2 className="font-semibold">Telegram Bot</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Link your Telegram account to receive signals and alerts via bot.
          </p>
        </div>
        <TelegramLinkForm
          userId={user!.id}
          currentChatId={profile?.telegram_chat_id ?? null}
        />
        <div className="rounded-lg bg-muted/40 p-3 text-xs text-muted-foreground space-y-1">
          <p className="font-medium text-foreground">How to find your Telegram Chat ID:</p>
          <ol className="list-decimal list-inside space-y-0.5">
            <li>Open Telegram and message <strong>@userinfobot</strong></li>
            <li>It will reply with your numeric user ID</li>
            <li>Paste that number below and save</li>
            <li>Then start our bot and send <strong>/start</strong></li>
          </ol>
        </div>
      </section>
    </div>
  )
}
