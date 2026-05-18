import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { MARKET_UNIVERSE } from '@/lib/market-universe'
import WatchlistClient from './WatchlistClient'

export const metadata = { title: 'Watchlist — AlgoSphere Quant' }
export const dynamic = 'force-dynamic'

interface WatchlistItem {
  symbol:      string
  asset_class: string
  added_at:    string
}

export default async function WatchlistPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data, error } = await supabase
    .from('watchlist_items')
    .select('symbol, asset_class, added_at')
    .eq('user_id', user.id)
    .order('added_at', { ascending: false })

  // Postgres 42P01 = table missing → migration hasn't been pushed.
  // Surface honestly instead of a 500 / mysterious empty page.
  const migrationPending = !!error && (error as { code?: string }).code === '42P01'
  const items = (data ?? []) as WatchlistItem[]

  return (
    <div className="mx-auto max-w-4xl px-4 py-6">
      <header className="mb-5">
        <h1 className="text-2xl font-bold tracking-tight">
          <span className="text-gradient">Watchlist</span>
        </h1>
        <p className="mt-1 text-xs text-muted-foreground">
          Pin instruments from the Market Universe. Live prices appear for asset
          classes with a connected feed; everything else is honestly labelled —
          never a fabricated quote.
        </p>
      </header>

      {migrationPending ? (
        <div className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-5 text-sm text-amber-200">
          <p className="font-semibold">Watchlist migration not yet applied.</p>
          <p className="mt-1 text-xs text-amber-200/80">
            The <code className="font-mono">watchlist_items</code> table is missing. Run{' '}
            <code className="font-mono">supabase db push</code> to apply migration{' '}
            <code className="font-mono">20240101000024_watchlist.sql</code>, then reload.
          </p>
        </div>
      ) : (
        <WatchlistClient
          initial={items}
          universe={MARKET_UNIVERSE.map((c) => ({
            assetClass: c.assetClass,
            label:      c.label,
            instruments: c.instruments.map((i) => ({
              symbol:     i.symbol,
              label:      i.label,
              group:      i.group ?? null,
              dataSource: i.dataSource,
            })),
          }))}
        />
      )}
    </div>
  )
}
