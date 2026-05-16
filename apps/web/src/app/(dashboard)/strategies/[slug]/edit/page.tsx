import { createClient } from '@/lib/supabase/server'
import { notFound, redirect } from 'next/navigation'
import EditStrategyForm from './EditStrategyForm'
import type { PublishedStrategy } from '@/lib/strategies'

export const metadata = { title: 'Edit Strategy — AlgoSphere Quant' }
export const dynamic = 'force-dynamic'

export default async function EditStrategyPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: strategy } = await supabase
    .from('published_strategies')
    .select('*')
    .eq('slug', slug)
    .eq('creator_id', user.id)
    .single()

  if (!strategy) notFound()

  return (
    <div className="mx-auto max-w-2xl px-4 py-6">
      <header className="mb-6">
        <a
          href={`/dashboard/strategies/${slug}`}
          className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1 mb-3"
        >
          ← Back to strategy
        </a>
        <h1 className="text-2xl font-bold tracking-tight">
          Edit <span className="text-gradient">Strategy</span>
        </h1>
      </header>

      <EditStrategyForm strategy={strategy as PublishedStrategy} />
    </div>
  )
}
