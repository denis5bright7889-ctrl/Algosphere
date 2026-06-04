'use client'

/**
 * Psychology leaderboard client — Global / Weekly / Monthly rankings of
 * opted-in traders by maturity, with discipline / consistency / patience.
 *
 * Fetches the consent-gated API per range, highlights the current user's
 * row, surfaces their percentile, and shows their earned achievement
 * badges (computed server-side and passed in). Tracks a view event per
 * range for the opt-in / engagement funnel.
 */
import { useCallback, useEffect, useState } from 'react'
import { Trophy, Award, Medal, Crown, Info } from 'lucide-react'
import { cn } from '@/lib/utils'
import { track } from '@/lib/tracking/client'
import type { PsychLeaderboardRow, LeaderboardRange } from '@/lib/intelligence/psychology-leaderboard'
import type { AchievementResult } from '@/lib/intelligence/psychology-v3'

interface ApiResponse {
  range:        LeaderboardRange
  generated_at: string
  participants: number
  rows:         PsychLeaderboardRow[]
  you:          PsychLeaderboardRow | null
}

const RANGES: Array<{ key: LeaderboardRange; label: string }> = [
  { key: 'global',  label: 'Global'  },
  { key: 'monthly', label: 'Monthly' },
  { key: 'weekly',  label: 'Weekly'  },
]

export default function LeaderboardClient({ achievements }: { achievements: AchievementResult }) {
  const [range, setRange]     = useState<LeaderboardRange>('global')
  const [data, setData]       = useState<ApiResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)

  const load = useCallback(async (r: LeaderboardRange) => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/psychology/leaderboard?range=${r}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`)
      setData(json as ApiResponse)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load leaderboard')
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load(range)
    track({ event: 'psychology_leaderboard_view', payload: { range } })
  }, [range, load])

  return (
    <div className="space-y-5">
      {/* Your achievements */}
      <section className="rounded-2xl border border-border bg-card p-5">
        <Header icon={Award} title="Your achievements" subtitle={`${achievements.earned.length} earned`} />
        {achievements.earned.length === 0 ? (
          <p className="mt-2 text-[12px] text-muted-foreground">
            No badges yet — keep your discipline, patience and consistency high to unlock them.
          </p>
        ) : (
          <div className="mt-3 flex flex-wrap gap-2">
            {achievements.earned.map((a) => (
              <span
                key={a.id}
                title={a.description}
                className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-[11px] font-semibold text-emerald-200"
              >
                <Award className="h-3 w-3" strokeWidth={2} aria-hidden />{a.name}
              </span>
            ))}
          </div>
        )}
        {achievements.upcoming.length > 0 && (
          <div className="mt-4 space-y-2">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">In progress</p>
            {achievements.upcoming.slice(0, 3).map((a) => (
              <div key={a.id} className="flex items-center gap-2">
                <span className="w-40 shrink-0 truncate text-[11px]" title={a.description}>{a.name}</span>
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-gradient-primary"
                    // eslint-disable-next-line react/forbid-dom-props
                    style={{ width: `${Math.round(a.progress * 100)}%` }}
                  />
                </div>
                <span className="w-9 shrink-0 text-right text-[10px] tabular-nums text-muted-foreground">
                  {Math.round(a.progress * 100)}%
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Range tabs */}
      <div className="flex items-center gap-1 rounded-lg border border-border bg-card p-1">
        {RANGES.map((r) => (
          <button
            key={r.key}
            type="button"
            onClick={() => setRange(r.key)}
            className={cn(
              'flex-1 rounded-md px-3 py-1.5 text-[12px] font-semibold transition-colors',
              range === r.key ? 'bg-gradient-primary text-black' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {r.label}
          </button>
        ))}
      </div>

      {/* Your percentile */}
      {data?.you && (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/[0.04] p-5">
          <div className="flex items-center gap-2">
            <Crown className="h-4 w-4 text-amber-300" strokeWidth={2} aria-hidden />
            <h2 className="text-sm font-semibold">Your standing</h2>
            <span className="ml-auto text-[11px] text-muted-foreground">{RANGES.find((r) => r.key === range)?.label}</span>
          </div>
          <div className="mt-3 flex flex-wrap items-end gap-6">
            <Big label="Rank" value={`#${data.you.rank}`} />
            <Big label="Percentile" value={`${data.you.percentile}`} suffix="th" />
            <Big label="Maturity" value={`${data.you.maturity_score}`} />
          </div>
        </div>
      )}

      {/* Rankings table */}
      <section className="rounded-2xl border border-border bg-card p-5">
        <Header icon={Trophy} title="Rankings" subtitle={data ? `${data.participants} participant${data.participants === 1 ? '' : 's'}` : undefined} />
        {loading ? (
          <p className="mt-3 text-[12px] text-muted-foreground">Loading rankings…</p>
        ) : error ? (
          <p className="mt-3 text-[12px] text-rose-400">{error}</p>
        ) : !data || data.rows.length === 0 ? (
          <p className="mt-3 flex items-start gap-2 text-[12px] text-muted-foreground">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-300" strokeWidth={2} />
            No ranked participants yet for this window. Opted-in traders appear here once they have 8+ closed trades.
          </p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[520px] text-[12px]">
              <thead className="text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="py-1.5 pr-2">#</th>
                  <th className="py-1.5 pr-2">Trader</th>
                  <th className="py-1.5 px-2 text-right">Maturity</th>
                  <th className="py-1.5 px-2 text-right">Discipline</th>
                  <th className="py-1.5 px-2 text-right">Consistency</th>
                  <th className="py-1.5 pl-2 text-right">Patience</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row) => (
                  <tr
                    key={`${row.rank}-${row.display_name}`}
                    className={cn('border-t border-border/40', row.is_you && 'bg-amber-500/[0.06]')}
                  >
                    <td className="py-1.5 pr-2 tabular-nums">
                      <RankBadge rank={row.rank} />
                    </td>
                    <td className="py-1.5 pr-2 font-medium">
                      {row.display_name}
                      {row.is_you && <span className="ml-1.5 rounded bg-amber-500/20 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-amber-200">You</span>}
                    </td>
                    <td className="py-1.5 px-2 text-right font-semibold tabular-nums">{row.maturity_score}</td>
                    <td className="py-1.5 px-2 text-right tabular-nums">{fmt(row.discipline_score)}</td>
                    <td className="py-1.5 px-2 text-right tabular-nums">{fmt(row.consistency_score)}</td>
                    <td className="py-1.5 pl-2 text-right tabular-nums">{fmt(row.patience_score)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}

function fmt(v: number | null): string {
  return v == null ? '—' : String(v)
}

function RankBadge({ rank }: { rank: number }) {
  if (rank <= 3) {
    const tone = rank === 1 ? 'text-amber-300' : rank === 2 ? 'text-zinc-300' : 'text-orange-300'
    return <span className={cn('inline-flex items-center gap-1 font-bold', tone)}><Medal className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />{rank}</span>
  }
  return <span className="text-muted-foreground">{rank}</span>
}

function Header({ icon: Icon, title, subtitle }: { icon: typeof Trophy; title: string; subtitle?: string }) {
  return (
    <div className="flex items-center gap-2">
      <Icon className="h-4 w-4 text-amber-300" strokeWidth={2} aria-hidden />
      <h2 className="text-sm font-semibold">{title}</h2>
      {subtitle && <span className="ml-auto text-[11px] text-muted-foreground">{subtitle}</span>}
    </div>
  )
}

function Big({ label, value, suffix }: { label: string; value: string; suffix?: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-3xl font-bold tabular-nums leading-none text-amber-300">
        {value}{suffix && <span className="text-sm opacity-60">{suffix}</span>}
      </div>
    </div>
  )
}
