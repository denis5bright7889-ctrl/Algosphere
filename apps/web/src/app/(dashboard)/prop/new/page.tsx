import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import NewChallengeForm from './NewChallengeForm'

export const metadata = { title: 'New Prop Challenge — AlgoSphere Quant' }
export const dynamic = 'force-dynamic'

export default async function NewChallengePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  return (
    <div className="mx-auto max-w-2xl px-4 py-6">
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">
          New <span className="text-gradient">Prop Challenge</span>
        </h1>
        <p className="mt-1 text-xs text-muted-foreground">
          Pick a firm preset — profit target, daily/total loss limits and trading-day quotas
          auto-fill from the real published rules. Override any field for non-standard challenges.
        </p>
      </header>
      <NewChallengeForm />
    </div>
  )
}
