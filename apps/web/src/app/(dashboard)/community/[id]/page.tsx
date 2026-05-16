import { createClient } from '@/lib/supabase/server'
import { notFound, redirect } from 'next/navigation'
import { formatDate } from '@/lib/utils'
import ThreadReplyForm from './ThreadReplyForm'
import VoteButtons from '@/components/social/VoteButtons'

export const dynamic = 'force-dynamic'

export default async function ThreadDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Fetch thread + replies
  const [{ data: thread }, { data: replies }] = await Promise.all([
    supabase
      .from('discussion_threads')
      .select(`
        *,
        profiles!discussion_threads_author_id_fkey ( public_handle, bio )
      `)
      .eq('id', id)
      .single(),
    supabase
      .from('discussion_replies')
      .select(`
        id, author_id, parent_reply_id, body, votes_score,
        is_solution, edited_at, created_at,
        profiles!discussion_replies_author_id_fkey ( public_handle )
      `)
      .eq('thread_id', id)
      .eq('is_flagged', false)
      .order('created_at', { ascending: true }),
  ])

  if (!thread) notFound()

  // Increment view count (fire-and-forget)
  supabase
    .from('discussion_threads')
    .update({ views_count: (thread.views_count ?? 0) + 1 })
    .eq('id', id)
    .then(() => {})

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <a
        href="/dashboard/community"
        className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1 mb-4"
      >
        ← Community
      </a>

      {/* Thread head */}
      <article className="rounded-2xl border border-border bg-card p-6 mb-4">
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold text-amber-300 capitalize">
            {thread.category}
          </span>
          {thread.tags?.map((tag: string) => (
            <span key={tag} className="text-[10px] text-muted-foreground">#{tag}</span>
          ))}
          {thread.is_resolved && (
            <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-300">
              ✓ Resolved
            </span>
          )}
          {thread.is_locked && (
            <span className="rounded-full bg-muted/40 px-2 py-0.5 text-[10px] font-bold text-muted-foreground">
              🔒 Locked
            </span>
          )}
        </div>

        <h1 className="text-2xl font-bold tracking-tight mb-3">{thread.title}</h1>

        <div className="flex items-center gap-3 text-[11px] text-muted-foreground mb-4">
          <a
            href={`/traders/${thread.profiles?.public_handle ?? ''}`}
            className="hover:text-amber-300"
          >
            @{thread.profiles?.public_handle ?? 'anonymous'}
          </a>
          <span>·</span>
          <span>{formatDate(thread.created_at)}</span>
          <span>·</span>
          <span>{thread.views_count} views</span>
        </div>

        <div className="text-sm whitespace-pre-wrap leading-relaxed">{thread.body}</div>

        <div className="mt-4 pt-4 border-t border-border/40">
          <VoteButtons
            targetType="thread"
            targetId={thread.id}
            initialScore={thread.votes_score}
            orientation="horizontal"
          />
        </div>
      </article>

      {/* Replies header */}
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-bold">
          {replies?.length ?? 0} {(replies?.length ?? 0) === 1 ? 'Reply' : 'Replies'}
        </h2>
      </div>

      {/* Replies */}
      <div className="space-y-2 mb-5">
        {(replies ?? []).map((r: any) => (
          <ReplyCard key={r.id} reply={r} threadAuthorId={thread.author_id} />
        ))}
      </div>

      {/* New reply form */}
      {!thread.is_locked && <ThreadReplyForm threadId={id} />}
    </div>
  )
}

function ReplyCard({ reply, threadAuthorId }: { reply: any; threadAuthorId: string }) {
  const isOP = reply.author_id === threadAuthorId
  return (
    <article className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <a
          href={`/traders/${reply.profiles?.public_handle ?? ''}`}
          className="text-xs font-semibold hover:text-amber-300"
        >
          @{reply.profiles?.public_handle ?? 'anonymous'}
        </a>
        {isOP && (
          <span className="rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-bold text-amber-300">
            OP
          </span>
        )}
        {reply.is_solution && (
          <span className="rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[9px] font-bold text-emerald-300">
            ✓ Solution
          </span>
        )}
        <span className="text-[10px] text-muted-foreground">·</span>
        <span className="text-[10px] text-muted-foreground">
          {new Date(reply.created_at).toLocaleString()}
        </span>
      </div>
      <p className="text-sm whitespace-pre-wrap leading-relaxed">{reply.body}</p>
      <div className="flex items-center gap-2 mt-3">
        <VoteButtons
          targetType="reply"
          targetId={reply.id}
          initialScore={reply.votes_score}
          orientation="horizontal"
        />
      </div>
    </article>
  )
}
