'use client'

import { Flame, Sparkles, ArrowUp, Radio } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useRealtimeThreads, type ThreadRow } from '@/hooks/useRealtimeThreads'

type Sort = 'hot' | 'new' | 'top'

interface Props {
  initial:  ThreadRow[]
  category: string
  sort:     Sort
}

/**
 * Realtime-augmented threads list. The server passes the initial page
 * (already sorted), this client component subscribes to inserts/
 * updates on `discussion_threads` and merges new rows in place. The
 * tiny `Radio` chip beside the sort tabs reflects the actual realtime
 * channel status — truthful, never claims "LIVE" when the channel
 * isn't subscribed.
 */
export default function ThreadsList({ initial, category, sort }: Props) {
  const { threads, connected } = useRealtimeThreads(initial, category)

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          {(['hot', 'new', 'top'] as const).map((s) => (
            <a
              key={s}
              href={`/community?cat=${category}&sort=${s}`}
              className={cn(
                'rounded-full px-3 py-1 text-[11px] font-medium transition-colors',
                sort === s ? 'bg-amber-500/10 text-amber-300' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <span className="inline-flex items-center gap-1">
                {s === 'hot' && <Flame    className="h-3 w-3" strokeWidth={2} aria-hidden />}
                {s === 'new' && <Sparkles className="h-3 w-3" strokeWidth={2} aria-hidden />}
                {s === 'top' && <ArrowUp  className="h-3 w-3" strokeWidth={2} aria-hidden />}
                {s === 'hot' ? 'Hot' : s === 'new' ? 'New' : 'Top'}
              </span>
            </a>
          ))}
        </div>
        <span
          title={connected ? 'Realtime channel active' : 'Realtime channel connecting…'}
          className={cn(
            'inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider',
            connected ? 'text-emerald-300' : 'text-muted-foreground',
          )}
        >
          <Radio
            className={cn('h-3 w-3', connected ? 'animate-pulse-soft' : 'opacity-50')}
            strokeWidth={2.25}
            aria-hidden
          />
          {connected ? 'Live' : '…'}
        </span>
      </div>

      {threads.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-12 text-center">
          <p className="text-sm text-muted-foreground">
            No discussions in {category === 'all' ? 'this community' : `the ${category} category`} yet.
          </p>
          <p className="mt-1.5 text-[11px] text-muted-foreground/70">
            Start one — your post will appear here live for everyone subscribed to this channel.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {threads.map((t) => <ThreadCard key={t.id} thread={t} />)}
        </div>
      )}
    </div>
  )
}

function ThreadCard({ thread }: { thread: ThreadRow }) {
  const handle = thread.profiles?.public_handle ?? 'anonymous'
  return (
    <a
      href={`/community/${thread.id}`}
      className="block rounded-xl border border-border bg-card p-4 transition-colors hover:border-amber-500/30"
    >
      <div className="flex items-start gap-3">
        <div className="flex min-w-[40px] flex-col items-center">
          <span className="text-xs text-muted-foreground">⬆</span>
          <span className={cn(
            'tabular-nums text-sm font-bold',
            thread.votes_score > 0 ? 'text-amber-300' : 'text-muted-foreground',
          )}>
            {thread.votes_score}
          </span>
        </div>

        <div className="min-w-0 flex-1">
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold capitalize text-amber-300">
              {thread.category}
            </span>
            {thread.tags?.slice(0, 2).map((tag) => (
              <span key={tag} className="text-[10px] text-muted-foreground">#{tag}</span>
            ))}
          </div>
          <h3 className="line-clamp-1 text-sm font-semibold">{thread.title}</h3>
          <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">{thread.body}</p>
          <div className="mt-2 flex items-center gap-3 text-[10px] text-muted-foreground">
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
