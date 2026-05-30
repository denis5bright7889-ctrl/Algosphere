/**
 * /optimization — Optimization Center (Refocus V3).
 *
 * V3 spec: Strategy Lab > Optimization Center should answer "Where is
 * my edge stable, and where am I overfit?" — by sweeping a strategy's
 * parameters and measuring how the metric varies across the range.
 *
 * Server shell mirrors /backtest: resolve the user's saved strategies
 * (with head version configs) so the client doesn't fan out a list
 * query. All sweep computation runs in the browser via the same
 * `executeStrategy` engine the backtester uses — no new API, no new
 * data pipeline. Honesty preserved: every metric is computed from
 * synthetic-bar replays (deterministic seed) until the user wires the
 * historical-OHLCV source.
 */
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import OptimizationClient, {
  type SavedStrategyOption,
} from './OptimizationClient'

export const metadata = { title: 'Optimization Center — AlgoSphere Quant' }
export const dynamic = 'force-dynamic'

export default async function OptimizationPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: strategies } = await supabase
    .from('user_strategies')
    .select(`
      id, name, head_version_id,
      head:user_strategy_versions!user_strategies_head_fk (
        id, version_number, config
      )
    `)
    .eq('user_id', user.id)
    .eq('is_archived', false)
    .order('updated_at', { ascending: false })
    .limit(50)

  const options: SavedStrategyOption[] = (strategies ?? []).map((s) => {
    const head = Array.isArray(s.head) ? s.head[0] : s.head
    return {
      id:       s.id,
      name:     s.name,
      version:  head?.version_number ?? null,
      config:   (head?.config ?? null) as SavedStrategyOption['config'],
    }
  })

  return (
    <div className="mx-auto max-w-4xl px-4 py-6">
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">
          Optimization <span className="text-gradient">Center</span>
        </h1>
        <p className="text-xs text-muted-foreground mt-1">
          Sweep a strategy parameter across a range, measure how the metric
          varies, and read the edge-stability score. Sharp peaks = overfit;
          a flat plateau = a robust edge.
        </p>
      </header>
      <OptimizationClient savedStrategies={options} />
    </div>
  )
}
