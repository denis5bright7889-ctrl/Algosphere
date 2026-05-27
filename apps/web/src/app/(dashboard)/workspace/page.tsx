/**
 * /workspace — institutional chart workspace (Phase 5).
 *
 * Server shell: auth gate only. All state + UI is in the client
 * orchestrator (workspaces persist to localStorage). The existing chart
 * modal at any "Open Chart" button is untouched and remains the
 * quick-look path.
 */
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import WorkspaceClient from './WorkspaceClient'

export const metadata = { title: 'Chart Workspace — AlgoSphere Quant' }
export const dynamic  = 'force-dynamic'

export default async function WorkspacePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  return <WorkspaceClient />
}
