import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import BrokersClient from './BrokersClient'

export const metadata = { title: 'Broker Connections — AlgoSphere Quant' }
export const dynamic = 'force-dynamic'

export default async function BrokersPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: conns } = await supabase
    .from('broker_connections')
    .select(`
      id, broker, label, account_id, is_live, is_testnet, status,
      equity_usd, equity_updated_at, error_message, is_default, created_at
    `)
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">
          Broker <span className="text-gradient">Connections</span>
        </h1>
        <p className="text-xs text-muted-foreground mt-1">
          Connect Binance / Bybit / OKX / MT5 / cTrader. Keys are encrypted with
          AES-256-GCM before storage — only the signal-engine can decrypt to
          execute, never the frontend.
        </p>
      </header>

      <BrokersClient initialConnections={conns ?? []} />
    </div>
  )
}
