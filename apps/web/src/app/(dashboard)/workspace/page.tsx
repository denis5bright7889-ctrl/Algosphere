/**
 * /workspace — institutional chart workspace (Phase 5).
 *
 * Server shell: auth gate + Premium tier gate. All state + UI is in the
 * client orchestrator (workspaces persist to localStorage). The existing
 * chart modal at any "Open Chart" button is untouched and remains the
 * quick-look path.
 *
 * Tier: wrapped in `<TierLock minTier="premium">` so free/starter see the
 * institutional workspace blurred behind an upgrade prompt — the brief's
 * "make the surface visible to drive upgrades" pattern. Premium+ get the
 * full client unchanged.
 */
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getEffectiveTier } from '@/lib/tier-resolver'
import TierLock from '@/components/tier/TierLock'
import WorkspaceClient from './WorkspaceClient'

export const metadata = { title: 'Chart Workspace — AlgoSphere Quant' }
export const dynamic  = 'force-dynamic'

export default async function WorkspacePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { tier } = await getEffectiveTier()

  return (
    <TierLock minTier="premium" tier={tier} from="/workspace">
      <WorkspaceClient />
    </TierLock>
  )
}
