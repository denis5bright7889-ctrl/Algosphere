/**
 * /psychology/leaderboard — consent-gated public psychology rankings.
 *
 * The page itself is a thin server shell: it authenticates, computes the
 * CURRENT user's own achievement badges (from their own journal — RLS
 * scoped) for the header, and hands off to the client which fetches the
 * ranked board per range. Cross-user ranking data never touches this
 * server component — it flows only through the service-role API, which
 * returns aggregate scores.
 */
import { redirect } from 'next/navigation'
import { Trophy, ArrowLeft } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { analyzeBehavior } from '@/lib/intelligence/behavioral'
import { computeRecoveryProfile, evaluateAchievements } from '@/lib/intelligence/psychology-v3'
import type { JournalEntry } from '@/lib/types'
import LeaderboardClient from './LeaderboardClient'

export const metadata = { title: 'Psychology Rankings — AlgoSphere Quant' }
export const dynamic = 'force-dynamic'

const WINDOW_DAYS = 180

export default async function PsychologyLeaderboardPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const cutoff = new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString()
  const { data: rows } = await supabase
    .from('journal_entries')
    .select('*')
    .eq('user_id', user.id)
    .gte('created_at', cutoff)
    .order('created_at', { ascending: false })
    .limit(1000)

  const entries     = (rows ?? []) as unknown as JournalEntry[]
  const report      = analyzeBehavior(entries as never, WINDOW_DAYS)
  const recovery    = computeRecoveryProfile(entries as never)
  const achievements = evaluateAchievements(report, recovery)

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <header className="mb-5">
        <a href="/psychology" className="mb-2 inline-flex items-center gap-1 text-[12px] text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-3.5 w-3.5" strokeWidth={2} aria-hidden /> Back to Psychology
        </a>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
          <Trophy className="h-6 w-6 text-amber-300" strokeWidth={2} aria-hidden />
          Psychology <span className="text-gradient">Rankings</span>
        </h1>
        <p className="mt-1 text-xs text-muted-foreground">
          Opt-in only. Ranked by trading maturity across discipline, consistency and patience.
          Enable participation in <a href="/settings" className="text-amber-300 hover:underline">Settings</a>.
        </p>
      </header>

      <LeaderboardClient achievements={achievements} />
    </div>
  )
}
