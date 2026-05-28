/**
 * /workspace — institutional chart workspace.
 *
 * Two surfaces under one route:
 *   • DESKTOP (md+): the premium multi-chart WorkspaceClient, gated by
 *     <TierLock minTier="premium">. Tier-locked because multi-chart is
 *     the institutional power feature.
 *   • MOBILE  (< md): the cockpit (TerminalWorkspace) — same chart-first
 *     experience as /overview, no extra gate. Multi-chart isn't usable
 *     on a phone; the cockpit is the right mobile fallback so the
 *     bottom-nav 'Chart' tab leads somewhere real instead of a blurred
 *     desktop layout.
 *
 * Both render server-side from this one file; CSS picks which is visible.
 */
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getEffectiveTier } from '@/lib/tier-resolver'
import { getOverviewData } from '@/lib/overview-data'
import TierLock from '@/components/tier/TierLock'
import TerminalWorkspace from '../overview/TerminalWorkspace'
import WorkspaceClient from './WorkspaceClient'

export const metadata = { title: 'Chart Workspace — AlgoSphere Quant' }
export const dynamic  = 'force-dynamic'

export default async function WorkspacePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [{ tier }, data] = await Promise.all([
    getEffectiveTier(),
    getOverviewData(),
  ])

  return (
    <>
      {/* Mobile cockpit (< md) — chart-first, unchanged from /overview. */}
      <div className="md:hidden">
        <TerminalWorkspace {...data} />
      </div>

      {/* Desktop multi-chart workspace (md+), tier-gated. */}
      <div className="hidden md:block">
        <TierLock minTier="premium" tier={tier} from="/workspace">
          <WorkspaceClient />
        </TierLock>
      </div>
    </>
  )
}
