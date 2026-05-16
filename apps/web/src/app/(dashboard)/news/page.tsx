import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import NewsClient from './NewsClient'

export const metadata = { title: 'Market News — AlgoSphere Quant' }
export const dynamic = 'force-dynamic'

export default async function NewsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  return (
    <div className="mx-auto max-w-4xl px-4 py-6">
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">
          Market <span className="text-gradient">News</span>
        </h1>
        <p className="text-xs text-muted-foreground mt-1">
          Aggregated from public RSS feeds. High-impact headlines flagged automatically.
        </p>
      </header>
      <NewsClient />
    </div>
  )
}
