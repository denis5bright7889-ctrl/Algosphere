import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import QuantBuilderClient from './QuantBuilderClient'

export const metadata = { title: 'Quant Strategy Builder — AlgoSphere Quant' }
export const dynamic = 'force-dynamic'

export default async function QuantBuilderPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  return (
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
  )
}
