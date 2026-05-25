/**
 * Market Intelligence — the orchestrator landing.
 *
 * The platform already has 7 standalone intelligence surfaces under
 * /intelligence/*, plus /market, /calendar, /news. This page consolidates
 * them into one institutional cockpit: cross-asset regime + correlations
 * at the top, then a clean grid linking out to every sub-surface organised
 * by purpose (Cross-asset, On-chain intelligence, Macro).
 *
 * Server component, auth-gated, no new APIs — reuses CrossAssetNarrative
 * and CorrelationsPanel (which fetch their own endpoints client-side).
 */
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import CrossAssetNarrative from '@/components/market/CrossAssetNarrative'
import CorrelationsPanel   from '@/components/market/CorrelationsPanel'

export const metadata = { title: 'Market Intelligence — AlgoSphere Quant' }
export const dynamic   = 'force-dynamic'

interface Tile { href: string; label: string; blurb: string; pill?: string }

const ASSET_CLASSES: Tile[] = [
  { href: '/market', label: 'Forex',          blurb: 'Majors, minors, crosses — live via Twelve Data.' },
  { href: '/market', label: 'Crypto',         blurb: 'BTC/ETH/SOL/… — live via Binance + Coinbase fallback.' },
  { href: '/market', label: 'Indices',        blurb: 'S&P 500, NASDAQ 100, Dow, DAX, FTSE, Nikkei.' },
  { href: '/market', label: 'Commodities',    blurb: 'Gold, silver, oil, metals, energy, ags.' },
  { href: '/market', label: 'Stocks',         blurb: 'US large-caps — Finnhub real-time, TD fallback.' },
  { href: '/market', label: 'Futures',        blurb: 'CME/ICE front-month — catalogued.' },
  { href: '/market', label: 'Bonds & Yields', blurb: 'US/UK/DE/JP sovereign yields — catalogued.' },
  { href: '/market', label: 'Volatility',     blurb: 'VIX live; crypto vol indices catalogued.', pill: 'new' },
]

const ONCHAIN: Tile[] = [
  { href: '/intelligence/smart-money',         label: 'Smart Money',         blurb: 'Where the institutional wallets are accumulating.' },
  { href: '/intelligence/whale-flows',         label: 'Whale Flows',         blurb: 'Large on-chain transfers as they happen.' },
  { href: '/intelligence/exchange-flows',      label: 'Exchange Flows',      blurb: 'Net inflows/outflows by venue.' },
  { href: '/intelligence/heatmap',             label: 'Liquidity Heatmap',   blurb: 'Where liquidity is clustering across pairs.' },
  { href: '/intelligence/token-momentum',      label: 'Token Momentum',      blurb: 'Cross-section ranking by momentum & vol.' },
  { href: '/intelligence/stablecoin-liquidity',label: 'Stablecoin Liquidity',blurb: 'USDT/USDC supply shifts — risk-asset fuel.' },
  { href: '/intelligence/market-rotation',     label: 'Market Rotation',     blurb: 'Where capital is rotating across sectors.' },
]

const MACRO: Tile[] = [
  { href: '/calendar', label: 'Macro Calendar', blurb: 'CPI, NFP, FOMC, rate decisions, GDP.' },
  { href: '/news',     label: 'Market News',    blurb: 'Curated wire feed for the trading session.' },
]

export default async function IntelligenceLandingPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  return (
    <main className="mx-auto max-w-6xl space-y-6 p-4 md:p-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">
          Market <span className="text-gradient">Intelligence</span>
        </h1>
        <p className="mt-1 text-xs text-muted-foreground">
          One cockpit for cross-asset regime, correlations, on-chain flows, and macro events.
        </p>
      </header>

      <CrossAssetNarrative />

      <CorrelationsPanel />

      <Section title="Asset Classes" tiles={ASSET_CLASSES}
               sub="Switch class in the Market Tracker — the working set follows the tab." />
      <Section title="On-chain Intelligence" tiles={ONCHAIN}
               sub="Live where the chain-engine service is deployed; static demo otherwise." />
      <Section title="Macro" tiles={MACRO} />
    </main>
  )
}

function Section({ title, sub, tiles }: { title: string; sub?: string; tiles: Tile[] }) {
  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
          {title}
        </h2>
        {sub && <span className="text-[11px] text-muted-foreground">{sub}</span>}
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {tiles.map(t => (
          <Link key={`${t.href}-${t.label}`} href={t.href}
                className="group rounded-2xl border border-border bg-card p-4 transition-colors hover:border-amber-500/40">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-sm font-semibold group-hover:text-amber-300 transition-colors">
                {t.label}
              </span>
              {t.pill && (
                <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] uppercase tracking-wider text-amber-300">
                  {t.pill}
                </span>
              )}
            </div>
            <p className="mt-1 text-xs text-muted-foreground leading-snug">{t.blurb}</p>
            <span className="mt-2 inline-block text-[11px] text-amber-300/80 group-hover:text-amber-300">
              Open →
            </span>
          </Link>
        ))}
      </div>
    </section>
  )
}
