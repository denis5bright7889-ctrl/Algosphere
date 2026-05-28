/**
 * /overview — the Command Center, chart-first (workstation layout).
 *
 * Server shell: resolves real KPIs + watchlist + active signals via the
 * shared `getOverviewData()` helper (also used by /workspace's mobile
 * cockpit fallback) and hands them to <TerminalWorkspace>.
 */
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getOverviewData } from '@/lib/overview-data'
import TerminalWorkspace from './TerminalWorkspace'

export const metadata = { title: 'Command Center' }
export const dynamic = 'force-dynamic'

export default async function OverviewPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const data = await getOverviewData()
  return <TerminalWorkspace {...data} />
}
