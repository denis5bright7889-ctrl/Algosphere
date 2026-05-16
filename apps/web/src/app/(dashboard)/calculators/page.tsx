import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import CalculatorsClient from './CalculatorsClient'

export const metadata = { title: 'Trading Calculators — AlgoSphere Quant' }
export const dynamic = 'force-dynamic'

export default async function CalculatorsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">
          Trading <span className="text-gradient">Calculators</span>
        </h1>
        <p className="text-xs text-muted-foreground mt-1">
          Position size, pip value, and risk-reward — instant, broker-agnostic.
        </p>
      </header>
      <CalculatorsClient />
    </div>
  )
}
