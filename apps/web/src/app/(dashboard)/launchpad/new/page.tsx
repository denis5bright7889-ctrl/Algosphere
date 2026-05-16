import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import NewLaunchForm from './NewLaunchForm'

export const metadata = { title: 'New Token Launch — AlgoSphere Quant' }
export const dynamic = 'force-dynamic'

export default async function NewLaunchPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <a
        href="/dashboard/launchpad"
        className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1 mb-3"
      >
        ← Launchpad
      </a>
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">
          Launch a <span className="text-gradient">Token</span>
        </h1>
        <p className="text-xs text-muted-foreground mt-1">
          Managed deployment — contract, liquidity lock, vesting, investor portal.
          A team member reviews every submission within 2 business days.
        </p>
      </header>

      <NewLaunchForm />
    </div>
  )
}
