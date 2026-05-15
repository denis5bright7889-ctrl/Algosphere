import { createClient } from '@/lib/supabase/server'
import PositionSizer from './PositionSizer'
import DailyLossTracker from './DailyLossTracker'
import AutoRiskPanel from '@/components/algo/AutoRiskPanel'
import TierGate from '@/components/algo/TierGate'
import { effectiveTierForFeatures } from '@/lib/demo'
import type { SubscriptionTier } from '@/lib/types'

export const metadata = { title: 'Risk Management' }

export default async function RiskPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const today = new Date().toISOString().slice(0, 10)

  const [{ data: profile }, { data: todayTrades }] = await Promise.all([
    supabase
      .from('profiles')
      .select('subscription_tier, account_type')
      .eq('id', user!.id)
      .single(),
    supabase
      .from('journal_entries')
      .select('pnl, risk_amount')
      .eq('user_id', user!.id)
      .eq('trade_date', today),
  ])

  const rawTier = (profile?.subscription_tier ?? 'free') as SubscriptionTier
  // Demo Pro users see the panel with simulated data
  const userTier = effectiveTierForFeatures(user?.email, rawTier, profile?.account_type)

  const todayPnl = todayTrades?.reduce((s, t) => s + (t.pnl ?? 0), 0) ?? 0
  const todayRisked = todayTrades?.reduce((s, t) => s + (t.risk_amount ?? 0), 0) ?? 0

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Risk Management</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Calculate position sizes and track daily exposure
        </p>
      </div>

      {/* Institutional auto risk engine — premium tier only (admin email bypasses) */}
      <TierGate requiredTier="premium" userTier={userTier} upgradeHref="/upgrade" blurContent={false}>
        <AutoRiskPanel />
      </TierGate>

      <div className="grid gap-6 lg:grid-cols-2">
        <PositionSizer />
        <DailyLossTracker todayPnl={todayPnl} todayRisked={todayRisked} todayTrades={todayTrades?.length ?? 0} />
      </div>

      {/* Risk rules reference */}
      <div className="rounded-xl border border-border bg-card p-5">
        <h2 className="font-semibold mb-4">Risk Rules Cheatsheet</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 text-sm">
          {[
            { rule: '1% rule', desc: 'Never risk more than 1% of account per trade' },
            { rule: '3% daily limit', desc: 'Stop trading if down 3% on the day' },
            { rule: '6% weekly limit', desc: 'Take the week off if down 6% total' },
            { rule: 'R:R minimum', desc: 'Only take trades with at least 1.5:1 reward-to-risk' },
            { rule: 'Position sizing', desc: 'Use lot size = (Risk $) ÷ (SL pips × pip value)' },
            { rule: 'Correlation', desc: 'Avoid holding EURUSD + GBPUSD simultaneously (correlated)' },
          ].map((r) => (
            <div key={r.rule} className="rounded-lg bg-muted/40 p-3">
              <p className="font-medium text-xs text-primary">{r.rule}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{r.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
