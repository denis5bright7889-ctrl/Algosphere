/**
 * /admin/feedback — admin triage of all feedback submissions.
 *
 * Server shell that gates on admin email and renders the client
 * triage UI. Lists all submissions newest-first with status +
 * severity badges, lets the admin update status and reply inline.
 */
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { isAdmin } from '@/lib/admin'
import FeedbackAdminClient from './FeedbackAdminClient'

export const metadata = { title: 'Feedback Triage — Admin' }
export const dynamic  = 'force-dynamic'

export default async function FeedbackAdminPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  if (!isAdmin(user.email)) redirect('/overview')

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Feedback Triage</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Every rating, question, bug, feature request, and review from the user-facing /feedback page.
          Open + in-review surface first; severity orders bugs.
        </p>
      </header>
      <FeedbackAdminClient />
    </div>
  )
}
