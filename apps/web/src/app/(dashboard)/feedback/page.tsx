/**
 * /feedback — Feedback Center (Phase 1).
 *
 * Server shell that gates on auth and renders the client form +
 * history. Supersedes the prior bug-report-only page; all five
 * feedback types (rating / question / bug / feature / review) live
 * in FeedbackClient.
 */
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import FeedbackClient from './FeedbackClient'

export const metadata = { title: 'Feedback Center — AlgoSphere Quant' }
export const dynamic  = 'force-dynamic'

export default async function FeedbackPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  return (
    <div className="mx-auto max-w-3xl px-1 py-4 sm:px-4 sm:py-6">
      <header className="mb-5">
        <h1 className="text-2xl font-bold tracking-tight">
          Feedback <span className="text-gradient">Center</span>
        </h1>
        <p className="mt-1 text-xs text-muted-foreground">
          Rate signals, ask questions, report bugs, request features. Everything you submit lands in our triage queue.
        </p>
      </header>
      <FeedbackClient />
    </div>
  )
}
