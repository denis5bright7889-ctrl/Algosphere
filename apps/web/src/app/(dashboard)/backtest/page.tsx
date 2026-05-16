import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import BacktestClient from './BacktestClient'

export const metadata = { title: 'Strategy Backtester — AlgoSphere Quant' }
export const dynamic = 'force-dynamic'

export default async function BacktestPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  return (
    <div className="mx-auto max-w-4xl px-4 py-6">
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">
          Strategy <span className="text-gradient">Backtester</span>
        </h1>
        <p className="text-xs text-muted-foreground mt-1">
          Replay EMA-trend, RSI-reversion, or breakout strategies with fixed-risk sizing.
        </p>
      </header>
      <BacktestClient />
    </div>
  )
}
