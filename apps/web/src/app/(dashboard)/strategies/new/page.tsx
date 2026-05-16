import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import PublishStrategyWizard from './PublishStrategyWizard'

export const metadata = { title: 'Publish Strategy — AlgoSphere Quant' }
export const dynamic = 'force-dynamic'

export default async function NewStrategyPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Check public profile requirement (Basic verification)
  const { data: profile } = await supabase
    .from('profiles')
    .select('public_profile, public_handle')
    .eq('id', user.id)
    .single()

  const needsProfile = !profile?.public_profile || !profile?.public_handle

  return (
    <div className="mx-auto max-w-2xl px-4 py-6">
      <header className="mb-6">
        <a
          href="/dashboard/strategies"
          className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1 mb-3"
        >
          ← Marketplace
        </a>
        <h1 className="text-2xl font-bold tracking-tight">
          Publish <span className="text-gradient">Strategy</span>
        </h1>
        <p className="text-xs text-muted-foreground mt-1">
          Share your edge. Earn 70% of subscription revenue + 20% of copy profits.
        </p>
      </header>

      {needsProfile ? (
        <div className="rounded-2xl border border-amber-500/40 bg-amber-500/[0.04] p-6">
          <p className="text-sm">
            You need a public trader profile before publishing strategies.
          </p>
          <a
            href="/dashboard/settings"
            className="btn-premium mt-3 inline-block !text-xs !py-2 !px-4"
          >
            Set up your handle
          </a>
        </div>
      ) : (
        <PublishStrategyWizard />
      )}
    </div>
  )
}
