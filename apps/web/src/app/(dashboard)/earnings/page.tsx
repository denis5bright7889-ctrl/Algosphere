import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import EarningsClient from './EarningsClient'

export const metadata = { title: 'Creator Earnings — AlgoSphere Quant' }
export const dynamic = 'force-dynamic'

export default async function EarningsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">
          Creator <span className="text-gradient">Earnings</span>
        </h1>
        <p className="text-xs text-muted-foreground mt-1">
          70% of subscription revenue + 20% of copy-trader profits.
          Payouts in USDT (TRC20).
        </p>
      </header>

      <EarningsClient />
    </div>
  )
}
