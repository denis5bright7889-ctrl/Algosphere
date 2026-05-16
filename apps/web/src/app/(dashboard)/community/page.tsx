import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { cn } from '@/lib/utils'
import CommunityClient from './CommunityClient'

export const metadata = { title: 'Community — AlgoSphere Quant' }
export const dynamic = 'force-dynamic'

const CATEGORIES = [
  { key: 'all',          label: 'All',           icon: '💬' },
  { key: 'signals',      label: 'Signals',       icon: '📡' },
  { key: 'strategy',     label: 'Strategy',      icon: '🎯' },
  { key: 'risk',         label: 'Risk',          icon: '🛡️' },
  { key: 'psychology',   label: 'Psychology',    icon: '🧠' },
  { key: 'crypto',       label: 'Crypto',        icon: '🪙' },
  { key: 'defi',         label: 'DeFi',          icon: '🌐' },
  { key: 'general',      label: 'General',       icon: '💭' },
  { key: 'announcements', label: 'Announcements', icon: '📢' },
] as const

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
          {CATEGORIES.map(c => (
            <a
              key={c.key}
              href={`/dashboard/community?cat=${c.key}&sort=${sort}`}
              className={cn(
                'flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors',
                cat === c.key
                  ? 'bg-amber-500/10 text-amber-300 font-semibold'
                  : 'text-muted-foreground hover:bg-muted/30 hover:text-foreground',
              )}
            >
              <span className="text-base">{c.icon}</span>
              {c.label}
            </a>
          ))}
        </nav>

        {/* Threads list */}
        <div>
          <div className="mb-3 flex items-center gap-1">
            {(['hot','new','top'] as const).map(s => (
              <a
                key={s}
                href={`/dashboard/community?cat=${cat}&sort=${s}`}
                className={cn(
                  'rounded-full px-3 py-1 text-[11px] font-medium transition-colors',
                  sort === s
                    ? 'bg-amber-500/10 text-amber-300'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {s === 'hot' ? '🔥 Hot' : s === 'new' ? '🆕 New' : '⬆ Top'}
              </a>
            ))}
          </div>

          {!threads || threads.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border p-12 text-center">
              <p className="text-sm text-muted-foreground">
                No discussions in {cat === 'all' ? 'this community' : `the ${cat} category`} yet.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {threads.map((t: any) => (
                <ThreadCard key={t.id} thread={t} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function ThreadCard({ thread }: { thread: any }) {
  const handle = thread.profiles?.public_handle ?? 'anonymous'
  return (
    <a
      href={`/dashboard/community/${thread.id}`}
      className="block rounded-xl border border-border bg-card p-4 hover:border-amber-500/30 transition-colors"
    >
      <div className="flex items-start gap-3">
        {/* Vote score */}
        <div className="flex flex-col items-center min-w-[40px]">
          <span className="text-xs text-muted-foreground">⬆</span>
          <span className={cn(
            'font-bold tabular-nums text-sm',
            thread.votes_score > 0 ? 'text-amber-300' : 'text-muted-foreground',
          )}>
            {thread.votes_score}
          </span>
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold text-amber-300 capitalize">
              {thread.category}
            </span>
            {thread.tags?.slice(0, 2).map((tag: string) => (
              <span key={tag} className="text-[10px] text-muted-foreground">
                #{tag}
              </span>
            ))}
          </div>
          <h3 className="text-sm font-semibold line-clamp-1">{thread.title}</h3>
          <p className="text-xs text-muted-foreground line-clamp-1 mt-1">{thread.body}</p>
          <div className="flex items-center gap-3 mt-2 text-[10px] text-muted-foreground">
            <span>@{handle}</span>
            <span>·</span>
            <span>{thread.replies_count} replies</span>
            <span>·</span>
            <span>{thread.views_count} views</span>
            <span>·</span>
            <span>{new Date(thread.created_at).toLocaleDateString()}</span>
          </div>
        </div>
      </div>
    </a>
  )
}
