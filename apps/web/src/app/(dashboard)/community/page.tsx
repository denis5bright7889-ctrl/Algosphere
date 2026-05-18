import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import {
  MessagesSquare, Activity, Target, ShieldCheck, Brain, Coins, Globe,
  MessageCircle, Megaphone,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import CommunityClient from './CommunityClient'
import ThreadsList from './ThreadsList'
import type { ThreadRow } from '@/hooks/useRealtimeThreads'

export const metadata = { title: 'Community — AlgoSphere Quant' }
export const dynamic = 'force-dynamic'

const CATEGORIES: { key: string; label: string; icon: LucideIcon }[] = [
  { key: 'all',           label: 'All',           icon: MessagesSquare },
  { key: 'signals',       label: 'Signals',       icon: Activity },
  { key: 'strategy',      label: 'Strategy',      icon: Target },
  { key: 'risk',          label: 'Risk',          icon: ShieldCheck },
  { key: 'psychology',    label: 'Psychology',    icon: Brain },
  { key: 'crypto',        label: 'Crypto',        icon: Coins },
  { key: 'defi',          label: 'DeFi',          icon: Globe },
  { key: 'general',       label: 'General',       icon: MessageCircle },
  { key: 'announcements', label: 'Announcements', icon: Megaphone },
]

export default async function CommunityPage({
  searchParams,
}: {
  searchParams: Promise<{ cat?: string; sort?: string }>
}) {
  const { cat = 'all', sort = 'hot' } = await searchParams
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  let query = supabase
    .from('discussion_threads')
    .select(`
      id, author_id, category, title, body, tags,
      views_count, replies_count, votes_score, last_reply_at, created_at,
      profiles!discussion_threads_author_id_fkey ( public_handle )
    `)
    .limit(50)

  if (cat !== 'all') {
    query = query.eq('category', cat)
  }

  if (sort === 'new')      query = query.order('created_at', { ascending: false })
  else if (sort === 'top') query = query.order('votes_score', { ascending: false })
  else                     query = query
    .order('votes_score', { ascending: false })
    .order('last_reply_at', { ascending: false, nullsFirst: false })

  const { data: threads } = await query

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <header className="mb-5 flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            <span className="text-gradient">Community</span>
          </h1>
          <p className="text-xs text-muted-foreground mt-1">
            Discuss strategies, share insights, ask questions.
          </p>
        </div>
        <CommunityClient currentUserId={user.id} />
      </header>

      <div className="grid grid-cols-1 md:grid-cols-[200px_1fr] gap-5">
        {/* Sidebar — categories */}
        <nav className="space-y-1 md:sticky md:top-20 md:self-start">
          {CATEGORIES.map(c => {
            const Icon = c.icon
            return (
              <a
                key={c.key}
                href={`/community?cat=${c.key}&sort=${sort}`}
                className={cn(
                  'flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors',
                  cat === c.key
                    ? 'bg-amber-500/10 text-amber-300 font-semibold'
                    : 'text-muted-foreground hover:bg-muted/30 hover:text-foreground',
                )}
              >
                <Icon className="h-4 w-4" strokeWidth={1.75} aria-hidden />
                {c.label}
              </a>
            )
          })}
        </nav>

        {/* Threads list — realtime-augmented client component */}
        <ThreadsList
          // Supabase's generated types model the FK-joined `profiles` as an
          // array even when the row syntax (`!discussion_threads_author_id_fkey`)
          // returns a single object. Cast through unknown to satisfy TS without
          // bending the runtime shape.
          initial={((threads ?? []) as unknown) as ThreadRow[]}
          category={cat}
          sort={(['hot', 'new', 'top'] as const).includes(sort as 'hot' | 'new' | 'top') ? sort as 'hot' | 'new' | 'top' : 'hot'}
        />
      </div>
    </div>
  )
}
