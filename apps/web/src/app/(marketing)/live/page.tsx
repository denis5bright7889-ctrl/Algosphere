/**
 * /live — public, no-auth proof-of-life signal feed.
 *
 * Purpose: when someone hits a share link on X / Reddit / Telegram /
 * anywhere, this is the page they land on. Shows the engine actually
 * working — recent signals (entry levels members-only, status visible to
 * everyone) and live regime activity across 25 instruments. The honest
 * social proof a real institutional engine actually has.
 *
 * Service-role read for safe columns only; full entry/SL/TP stay behind
 * the paid tier (same protection as the authed feed).
 */
import Link from 'next/link'
import { createClient as serviceClient } from '@supabase/supabase-js'
import { cn } from '@/lib/utils'
import ShareButtons from './ShareButtons'

export const metadata = {
  title: 'Live Signals — see the engine working in real time',
  description:
    'Watch AlgoSphere Quant\'s institutional engine scan 25 instruments in real time — regime, momentum, conviction, and risk-gated signals as they happen. Free to view; entry levels are member-only.',
  alternates: { canonical: '/live' },
  openGraph: {
    type: 'website',
    title: 'AlgoSphere Quant — Live institutional signals',
    description:
      'Real-time institutional intelligence across forex, metals, indices and crypto. Free to view; member-only entry levels.',
    url: '/live',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'AlgoSphere Quant — Live institutional signals',
    description:
      'Real-time institutional intelligence across forex, metals, indices and crypto.',
  },
}

export const dynamic  = 'force-dynamic'
export const revalidate = 30  // light edge cache to absorb viral spikes

interface PublicSignal {
  pair: string
  direction: string
  regime: string | null
  confidence_score: number | null
  status: string
  result: string | null
  published_at: string
}

interface PublicRegime {
  symbol: string
  regime: string
  der_score: number
  scanned_at: string
}

function svc() {
  return serviceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

async function loadFeed() {
  const db = svc()
  // Safe columns only — entry/SL/TP stay member-only.
  const [{ data: signals }, { data: regimes }, { count: total }] = await Promise.all([
    db.from('signals')
      .select('pair, direction, regime, confidence_score, status, result, published_at')
      .order('published_at', { ascending: false })
      .limit(20),
    db.from('regime_snapshots')
      .select('symbol, regime, der_score, scanned_at')
      .order('scanned_at', { ascending: false })
      .limit(80),
    db.from('signals').select('*', { count: 'exact', head: true }),
  ])

  // Dedupe regimes by latest-per-symbol.
  const seen = new Set<string>()
  const latestRegimes: PublicRegime[] = []
  for (const r of regimes ?? []) {
    if (seen.has(r.symbol)) continue
    seen.add(r.symbol)
    latestRegimes.push(r as PublicRegime)
  }

  const wins   = (signals ?? []).filter((s) => s.result === 'win').length
  const losses = (signals ?? []).filter((s) => s.result === 'loss').length
  const closed = wins + losses
  const winRate = closed > 0 ? Math.round((wins / closed) * 100) : null

  return {
    signals:   (signals as PublicSignal[] | null) ?? [],
    regimes:   latestRegimes,
    totals:    { total: total ?? 0, wins, losses, winRate },
    generated_at: new Date().toISOString(),
  }
}

export default async function LivePage() {
  const view = await loadFeed()
  const scanned = view.regimes.length

  return (
    <main className="mx-auto max-w-5xl space-y-8 px-4 py-8 md:py-12">
      <header className="space-y-3 text-center">
        <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-emerald-300">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400/60" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
          </span>
          Engine live · {scanned} instruments scanning
        </div>
        <h1 className="text-3xl font-bold tracking-tight md:text-4xl">
          AlgoSphere Quant — <span className="text-gradient">live signals</span>
        </h1>
        <p className="mx-auto max-w-2xl text-sm text-muted-foreground">
          The institutional engine scanning forex, metals, indices and crypto in real time —
          regime classification, weighted-ensemble strategies, persistent OHLCV cache, and
          risk-gated signal generation. Entry, stop and targets are member-only; the engine&apos;s
          activity itself is public.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
          <Link href="/signup" className="rounded-lg bg-gradient-primary px-5 py-2.5 text-sm font-bold text-black shadow-glow-gold">
            Get full signals — free
          </Link>
          <Link href="/investors" className="rounded-lg border border-border px-5 py-2.5 text-sm font-semibold text-foreground hover:border-amber-500/40">
            For investors →
          </Link>
        </div>
      </header>

      {/* Track-record strip (only when there's data) */}
      {view.totals.total > 0 && (
        <section className="rounded-2xl border border-border bg-card/40 p-4">
          <div className="grid grid-cols-3 gap-3 text-center">
            <Stat label="Signals all-time"  value={String(view.totals.total)} />
            <Stat label="Win rate (closed)"
                  value={view.totals.winRate != null ? `${view.totals.winRate}%` : '—'}
                  tone={view.totals.winRate != null && view.totals.winRate >= 60 ? 'text-emerald-400' : ''} />
            <Stat label="Closed wins / losses" value={`${view.totals.wins} / ${view.totals.losses}`} />
          </div>
        </section>
      )}

      {/* Signals */}
      <section className="space-y-3">
        <h2 className="text-[11px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
          Recent signals
        </h2>
        {view.signals.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border bg-card/30 p-6 text-center text-sm text-muted-foreground">
            Engine is scanning — no signal has cleared the institutional risk gate in the
            current window. The system declines to trade weak / contradictory setups by
            design. Watch the regime activity below for live engine work.
          </div>
        ) : (
          <ul className="space-y-2">
            {view.signals.map((s, i) => (
              <li key={`${s.pair}-${s.published_at}-${i}`}>
                <SignalCard sig={s} />
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Live regime activity — proof-of-life even when no signal */}
      <section className="space-y-3">
        <h2 className="text-[11px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
          Engine activity · last regime read per instrument
        </h2>
        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 md:grid-cols-4">
          {view.regimes.map((r) => (
            <div key={r.symbol} className="rounded-lg border border-border/60 bg-card/40 px-2.5 py-1.5">
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-mono text-xs font-semibold">{r.symbol}</span>
                <span className="text-[9px] uppercase tracking-wider text-muted-foreground">{regimeShort(r.regime)}</span>
              </div>
              <div className="text-[10px] text-muted-foreground/80 tabular-nums">DER {r.der_score.toFixed(2)}</div>
            </div>
          ))}
        </div>
      </section>

      <footer className="border-t border-border/60 pt-6">
        <ShareButtons />
        <p className="mt-4 text-center text-[11px] text-muted-foreground">
          Built honestly. Signals are generated by a quantitative engine, risk-gated, and
          published only when conviction clears institutional thresholds — no fake history,
          no fake metrics. Updated {new Date(view.generated_at).toLocaleTimeString()}.
        </p>
      </footer>
    </main>
  )
}

// ── Components ──────────────────────────────────────────────────────────

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div>
      <div className={cn('text-2xl font-semibold tabular-nums', tone ?? 'text-foreground')}>{value}</div>
      <div className="mt-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
    </div>
  )
}

function SignalCard({ sig }: { sig: PublicSignal }) {
  const buy = sig.direction?.toLowerCase() === 'buy'
  const status = sig.result ?? sig.status
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border/60 bg-card/40 px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm font-bold">{sig.pair}</span>
          <span className={cn(
            'rounded-md border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider',
            buy ? 'border-emerald-500/30 bg-emerald-500/15 text-emerald-300'
                : 'border-rose-500/30 bg-rose-500/15 text-rose-300',
          )}>
            {sig.direction}
          </span>
          {sig.regime && (
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{sig.regime}</span>
          )}
          {sig.confidence_score != null && (
            <span className="ml-auto text-[10px] text-muted-foreground">conf {sig.confidence_score}</span>
          )}
        </div>
        <div className="mt-0.5 text-[11px] text-muted-foreground">
          🔒 Entry / Stop / Targets are members-only ·{' '}
          <Link href="/signup" className="text-amber-300 hover:underline">Unlock free →</Link>
        </div>
      </div>
      <div className="shrink-0 text-right">
        <div className={cn(
          'text-[10px] font-semibold uppercase tracking-wider',
          status === 'win' ? 'text-emerald-400'
            : status === 'loss' ? 'text-rose-400'
            : 'text-muted-foreground',
        )}>
          {status}
        </div>
        <div className="text-[10px] text-muted-foreground">{new Date(sig.published_at).toLocaleTimeString()}</div>
      </div>
    </div>
  )
}

function regimeShort(r: string): string {
  return (r || '—').replace('_', ' ')
}
