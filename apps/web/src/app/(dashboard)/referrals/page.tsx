import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { formatDate } from '@/lib/utils'
import { summarize, DEFAULT_COMMISSION_PCT, type ReferralRow } from '@/lib/referrals'
import ReferralLinkCard from './ReferralLinkCard'
import AnimatedNumber from '@/components/ui/AnimatedNumber'

export const metadata = { title: 'Affiliate' }

const STATUS_FALLBACK = { label: 'Signed up', cls: 'bg-muted/40 text-muted-foreground' }
const STATUS_META: Record<string, { label: string; cls: string }> = {
  signed_up: STATUS_FALLBACK,
  converted: { label: 'Converted', cls: 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30' },
  paid:      { label: 'Paid out',  cls: 'bg-amber-500/15 text-amber-300 border border-amber-500/30' },
}

export default async function ReferralsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('referral_code')
    .eq('id', user.id)
    .single()

  const { data: rawRows } = await supabase
    .from('referrals')
    .select('id, referrer_id, referred_id, commission_pct, commission_paid, commission_amount, plan, status, created_at, converted_at, paid_at')
    .eq('referrer_id', user.id)
    .order('created_at', { ascending: false })

  const rows = (rawRows ?? []) as ReferralRow[]
  const stats = summarize(rows)
  const code = profile?.referral_code ?? ''

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Hero */}
      <div className="relative overflow-hidden rounded-2xl border border-border bg-card p-5 sm:p-6">
        <div className="absolute inset-x-0 top-0 h-px gradient-strip" aria-hidden />
        <div className="absolute inset-0 bg-gradient-mesh opacity-60 pointer-events-none" aria-hidden />
        <div className="relative">
          <span className="inline-block rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-[10px] font-bold tracking-widest text-amber-300 uppercase">
            Affiliate Program
          </span>
          <h1 className="mt-3 text-xl sm:text-3xl font-bold tracking-tight">
            Earn with <span className="text-gradient">AlgoSphere Quant</span>
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Share your link · earn {DEFAULT_COMMISSION_PCT}% of every referred subscription
          </p>
        </div>
      </div>

      {code ? (
        <ReferralLinkCard code={code} commissionPct={DEFAULT_COMMISSION_PCT} />
      ) : (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-5 text-sm text-amber-200">
          Your referral code isn&apos;t provisioned yet. Run the
          <code className="mx-1 text-xs">20240101000008_referral_system.sql</code>
          migration, then refresh.
        </div>
      )}

      {/* Stat tiles */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatTile label="Total Referred" value={stats.total} accent="cyan" />
        <StatTile label="Converted"      value={stats.converted} suffix={` (${stats.conversionRate}%)`} accent="emerald" />
        <StatTile label="Pending Payout" value={stats.pendingUsd} prefix="$" decimals={2} accent="gold" />
        <StatTile label="Lifetime Earned" value={stats.lifetimeUsd} prefix="$" decimals={2} accent="gold" />
      </div>

      {/* Referral table */}
      <div className="card-premium p-5">
        <h2 className="font-semibold tracking-tight mb-4">Referral activity</h2>
        {rows.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-10 text-center">
            <p className="text-sm text-muted-foreground">
              No referrals yet. Share your link above — earnings appear here the moment
              a referred trader subscribes.
            </p>
          </div>
        ) : (
          <>
            {/* Mobile cards */}
            <ul className="space-y-3 md:hidden">
              {rows.map((r) => {
                const m = STATUS_META[r.status] ?? STATUS_FALLBACK
                return (
                  <li key={r.id} className="rounded-xl border border-border bg-card p-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">
                        {formatDate(r.created_at)}
                      </span>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${m.cls}`}>
                        {m.label}
                      </span>
                    </div>
                    <div className="mt-2 flex items-center justify-between text-sm">
                      <span className="text-muted-foreground capitalize">
                        {r.plan ?? '—'}
                      </span>
                      <span className="font-bold tabular-nums text-amber-300">
                        {r.commission_amount > 0 ? `$${r.commission_amount.toFixed(2)}` : '—'}
                      </span>
                    </div>
                  </li>
                )
              })}
            </ul>

            {/* Desktop table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-muted-foreground">
                    {['Referred on', 'Plan', 'Status', 'Commission'].map((h) => (
                      <th key={h} className="px-3 py-2 font-medium">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const m = STATUS_META[r.status] ?? STATUS_FALLBACK
                    return (
                      <tr key={r.id} className="border-b border-border last:border-0">
                        <td className="px-3 py-2.5 text-muted-foreground whitespace-nowrap">
                          {formatDate(r.created_at)}
                        </td>
                        <td className="px-3 py-2.5 capitalize">{r.plan ?? '—'}</td>
                        <td className="px-3 py-2.5">
                          <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${m.cls}`}>
                            {m.label}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 font-bold tabular-nums text-amber-300">
                          {r.commission_amount > 0 ? `$${r.commission_amount.toFixed(2)}` : '—'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      <p className="text-center text-xs text-muted-foreground">
        Payouts are processed manually. Pending commission is paid once the referred
        subscription clears its first billing cycle.
      </p>
    </div>
  )
}

function StatTile({
  label, value, prefix, suffix, decimals, accent,
}: {
  label: string; value: number; prefix?: string; suffix?: string
  decimals?: number; accent?: 'cyan' | 'emerald' | 'gold'
}) {
  const cls =
    accent === 'emerald' ? 'text-emerald-400 glow-text-emerald' :
    accent === 'gold'    ? 'text-amber-300 glow-text-gold' :
    'text-amber-300 glow-text-gold'
  return (
    <div className="card-premium p-3 sm:p-4 relative overflow-hidden">
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-primary opacity-50" aria-hidden />
      <p className="text-[11px] sm:text-xs text-muted-foreground truncate uppercase tracking-wider">{label}</p>
      <p className={`mt-1 text-lg sm:text-2xl font-bold tabular-nums truncate ${cls}`}>
        <AnimatedNumber value={value} prefix={prefix} suffix={suffix} decimals={decimals ?? 0} />
      </p>
    </div>
  )
}
