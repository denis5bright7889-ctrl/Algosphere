/**
 * /quant-builder — visual no-code strategy composer.
 *
 * Auth gate + Premium tier gate. The builder itself is a client island;
 * server simply resolves the viewer's effective tier and hands rendering
 * to <TierLock>. Free/starter see the builder blurred behind an upgrade
 * prompt (drives upsell); premium+ get the unaltered surface.
 */
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getEffectiveTier } from '@/lib/tier-resolver'
import TierLock from '@/components/tier/TierLock'
import QuantBuilderClient from './QuantBuilderClient'

export const metadata = { title: 'Quant Strategy Builder — AlgoSphere Quant' }
export const dynamic = 'force-dynamic'

export default async function QuantBuilderPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { tier } = await getEffectiveTier()

  return (
    <TierLock minTier="premium" tier={tier} from="/quant-builder">
      <div className="mx-auto max-w-5xl px-4 py-6">
        <header className="mb-6">
          <h1 className="text-2xl font-bold tracking-tight">
            Quant Strategy <span className="text-gradient">Builder</span>
          </h1>
          <p className="text-xs text-muted-foreground mt-1">
            Compose entry rules visually. Backtest instantly. Publish to the marketplace.
          </p>
        </header>
        <QuantBuilderClient />
      </div>
    </TierLock>
  )
}
