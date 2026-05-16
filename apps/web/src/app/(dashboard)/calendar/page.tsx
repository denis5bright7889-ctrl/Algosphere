import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import CalendarClient from './CalendarClient'

export const metadata = { title: 'Economic Calendar — AlgoSphere Quant' }
export const dynamic = 'force-dynamic'

export default async function CalendarPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  return (
    <div className="mx-auto max-w-4xl px-4 py-6">
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">
          Economic <span className="text-gradient">Calendar</span>
        </h1>
        <p className="text-xs text-muted-foreground mt-1">
          High-impact events this week. Avoid trading 15 min around red events.
        </p>
      </header>
      <CalendarClient />
    </div>
  )
}
