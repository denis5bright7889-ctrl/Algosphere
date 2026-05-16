import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import PsychologyClient from './PsychologyClient'

export const metadata = { title: 'AI Psychology Coach — AlgoSphere Quant' }
export const dynamic = 'force-dynamic'

export default async function PsychologyPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">
          AI <span className="text-gradient">Psychology Coach</span>
        </h1>
        <p className="text-xs text-muted-foreground mt-1">
          Gemini analyzes the last 30 days of your trades, emotions, and
          mistakes — and tells you exactly what to work on.
        </p>
      </header>
      <PsychologyClient />
    </div>
  )
}
