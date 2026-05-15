import { createClient as serviceClient } from '@supabase/supabase-js'
import SignalManager from './SignalManager'
import type { Strategy } from '@/lib/types'

export const metadata = { title: 'Admin — Intelligence Feed' }
export const dynamic = 'force-dynamic'

function db() {
  return serviceClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

export default async function AdminSignalsPage() {
  const svc = db()

  const [{ data: signals }, { data: strategies }] = await Promise.all([
    svc.from('signals')
      .select('*, strategy:strategy_id (name, display_name)')
      .order('published_at', { ascending: false })
      .limit(100),
    svc.from('strategy_registry').select('*').eq('active', true).order('name'),
  ])

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Intelligence Feed Management</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Create, monitor and manage the full signal lifecycle
          </p>
        </div>
      </div>
      <SignalManager
        initialSignals={(signals ?? []) as Parameters<typeof SignalManager>[0]['initialSignals']}
        strategies={(strategies ?? []) as Strategy[]}
      />
    </div>
  )
}
