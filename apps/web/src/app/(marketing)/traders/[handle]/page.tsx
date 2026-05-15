import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import Logo from '@/components/brand/Logo'
import { formatDate } from '@/lib/utils'
import { type TraderProfile } from '@/lib/leaderboard'
import { cn } from '@/lib/utils'

interface Props {
  params: Promise<{ handle: string }>
}

export async function generateMetadata({ params }: Props) {
  const { handle } = await params
  return {
    title: `${handle} — Verified Trader · AlgoSphere Quant`,
    description: `Verified, journal-backed performance for ${handle} on AlgoSphere Quant.`,
  }
}

export const revalidate = 120

export default async function TraderProfilePage({ params }: Props) {
  const { handle } = await params
  const supabase = await createClient()
  const { data } = await supabase.rpc('trader_profile', { p_handle: handle })
  const p = (data?.[0] ?? null) as TraderProfile | null

  if (!p) notFound()

  const stats = [
    { label: 'Win Rate',    value: `${p.win_rate ?? 0}%`,                 tone: 'gold'    },
    { label: 'Net P&L',     value: `${p.total_pnl >= 0 ? '+' : ''}$${p.total_pnl.toLocaleString()}`, tone: p.total_pnl >= 0 ? 'green' : 'red' },
    { label: 'Trades',      value: String(p.trades),                       tone: 'plain'   },
    { label: 'Wins / Losses', value: `${p.wins} / ${p.losses}`,            tone: 'plain'   },
    { label: 'Best Trade',  value: `+$${p.best_trade.toLocaleString()}`,    tone: 'green'   },
    { label: 'Worst Trade', value: `$${p.worst_trade.toLocaleString()}`,    tone: 'red'     },
  ]

  return (
    <main className="min-h-screen">
      <header className="sticky top-0 z-50 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-3">
          <a href="/traders" className="text-sm text-muted-foreground hover:text-foreground">
            ← Leaderboard
          </a>
          <a href="/" className="flex items-center gap-2 text-base font-bold tracking-tight">
            <Logo size="sm" alt="" />
            <span><span className="text-gradient">AlgoSphere</span> Quant</span>
          </a>
        </div>
      </header>

      <section className="relative mx-auto max-w-4xl px-4 py-12 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-mesh opacity-50 pointer-events-none" aria-hidden />

        <div className="relative rounded-2xl border border-border bg-card p-6 sm:p-8">
          <div className="absolute inset-x-0 top-0 h-px gradient-strip" aria-hidden />
          <span className="inline-block rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-[10px] font-bold tracking-widest text-amber-300 uppercase">
            Verified · Journal-backed
          </span>
          <h1 className="mt-4 text-3xl font-bold tracking-tight">
            <span className="text-gradient">{p.handle}</span>
          </h1>
          {p.bio && <p className="mt-2 text-muted-foreground max-w-xl">{p.bio}</p>}
          <p className="mt-1 text-xs text-muted-foreground">
            Member since {formatDate(p.member_since)}
          </p>

          <div className="mt-6 grid grid-cols-2 sm:grid-cols-3 gap-3">
            {stats.map(s => (
              <div key={s.label} className="rounded-xl border border-border bg-background/50 p-4">
                <p className="text-[11px] uppercase tracking-wider text-muted-foreground">{s.label}</p>
                <p className={cn(
                  'mt-1 text-xl font-bold tabular-nums',
                  s.tone === 'gold'  && 'text-amber-300 glow-text-gold',
                  s.tone === 'green' && 'text-emerald-400',
                  s.tone === 'red'   && 'text-rose-400',
                )}>
                  {s.value}
                </p>
              </div>
            ))}
          </div>
        </div>

        <div className="relative mt-6 rounded-2xl border border-amber-500/30 bg-amber-500/[0.05] p-6 text-center">
          <p className="text-sm text-muted-foreground">
            These numbers are aggregated from a real trade journal — no self-reported
            figures, no individual trades exposed.
          </p>
          <a href="/signup" className="btn-premium mt-4 inline-block !text-sm">
            Build your own verified track record
          </a>
        </div>
      </section>
    </main>
  )
}
