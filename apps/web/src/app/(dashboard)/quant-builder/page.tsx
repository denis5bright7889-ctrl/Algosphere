/**
 * /quant-builder — strategy library + composer (Refocus R5b).
 *
 * Tier-gated (Premium). Server lists the user's saved strategies and
 * resolves the catalogue; the client island handles all editing and
 * version operations through the /api/strategies CRUD.
 */
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getEffectiveTier } from '@/lib/tier-resolver'
import TierLock from '@/components/tier/TierLock'
import QuantBuilderClient, {
  type StrategyRow,
} from './QuantBuilderClient'
import { STRATEGY_TEMPLATES } from '@/lib/strategies/templates'

export const metadata = { title: 'Quant Strategy Builder — AlgoSphere Quant' }
export const dynamic  = 'force-dynamic'

export default async function QuantBuilderPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { tier } = await getEffectiveTier()

  // Load the user's strategy list with their head versions inline so
  // the client doesn't fan out on first render.
  const { data: strategies } = await supabase
    .from('user_strategies')
    .select(`
      id, name, description, template_key, is_archived,
      head_version_id, created_at, updated_at,
      head:user_strategy_versions!user_strategies_head_fk (
        id, version_number, notes, config, created_at
      )
    `)
    .eq('user_id', user.id)
    .eq('is_archived', false)
    .order('updated_at', { ascending: false })
    .limit(100)

  return (
    <TierLock minTier="premium" tier={tier} from="/quant-builder">
      <div className="mx-auto max-w-6xl px-4 py-6">
        <header className="mb-6">
          <h1 className="text-2xl font-bold tracking-tight">
            Quant Strategy <span className="text-gradient">Builder</span>
          </h1>
          <p className="text-xs text-muted-foreground mt-1">
            Compose modular block strategies, version every save, clone proven templates.
            Backtest them on <a href="/backtest" className="text-amber-300 hover:underline">/backtest</a>.
          </p>
        </header>
        <QuantBuilderClient
          initialStrategies={(strategies ?? []) as unknown as StrategyRow[]}
          templates={STRATEGY_TEMPLATES.map((t) => ({
            key:       t.key,
            name:      t.name,
            category:  t.category,
            summary:   t.summary,
            timeframe: t.timeframe,
            pair_hint: t.pair_hint,
          }))}
        />
      </div>
    </TierLock>
  )
}
