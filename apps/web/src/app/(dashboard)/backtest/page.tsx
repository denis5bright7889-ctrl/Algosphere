/**
 * /backtest — strategy backtester (Refocus R5c).
 *
 * Now serves two modes:
 *   • Built-in: EMA-trend, RSI-reversion, breakout (the original
 *     hardcoded strategies via runBacktest)
 *   • User-authored: load a saved strategy from R5b's user_strategies
 *     and execute its block config via lib/strategies/executor.
 *     Triggered by ?strategy_id=<uuid> in the URL.
 *
 * Server resolves the user's strategy list so the picker doesn't
 * have to fan out client-side.
 */
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import BacktestClient, {
  type SavedStrategyOption,
} from './BacktestClient'

export const metadata = { title: 'Strategy Backtester — AlgoSphere Quant' }
export const dynamic = 'force-dynamic'

export default async function BacktestPage({
  searchParams,
}: {
  searchParams: Promise<{ strategy_id?: string }>
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const params = await searchParams
  const requestedStrategyId = params.strategy_id ?? null

  // List user's saved strategies for the picker.
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
          Strategy <span className="text-gradient">Backtester</span>
        </h1>
        <p className="text-xs text-muted-foreground mt-1">
          Replay built-in strategies or your own block-authored configs from{' '}
          <a href="/quant-builder" className="text-amber-300 hover:underline">/quant-builder</a>.
          Includes cost models + Monte Carlo robustness on the result.
        </p>
      </header>
      <BacktestClient
        savedStrategies={options}
        initialStrategyId={requestedStrategyId}
      />
    </div>
  )
}
