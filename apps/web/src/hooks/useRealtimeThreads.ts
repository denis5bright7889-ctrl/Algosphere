'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

/**
 * Realtime feed for /community.
 *
 * Mirrors the proven `useRealtimeSignals` pattern: subscribes to
 * `discussion_threads` postgres_changes and merges INSERT/UPDATE
 * into the initial server-rendered list. INSERT payloads from
 * postgres_changes don't carry the joined `profiles` row, so we
 * fetch the new row with its profile before merging — keeps the
 * UI honest about authorship.
 *
 * Category filtering is applied client-side: a server-paginated
 * 'crypto' page only accepts new threads in that category, so
 * switching categories doesn't need a re-subscribe.
 */
export interface ThreadRow {
  id:              string
  author_id:       string
  category:        string
  title:           string
  body:            string
  tags:            string[] | null
  views_count:     number
  replies_count:   number
  votes_score:     number
  last_reply_at:   string | null
  created_at:      string
  profiles:        { public_handle: string | null } | null
}

const SELECT = `
  id, author_id, category, title, body, tags,
  views_count, replies_count, votes_score, last_reply_at, created_at,
  profiles!discussion_threads_author_id_fkey ( public_handle )
`

export function useRealtimeThreads(initial: ThreadRow[], category: string) {
  const [threads, setThreads] = useState<ThreadRow[]>(initial)
  const [connected, setConnected] = useState(false)

  useEffect(() => {
    // Reset to the new server snapshot whenever the category changes —
    // the parent component re-renders on URL change so `initial` is
    // already correct for the active category.
    setThreads(initial)
  }, [initial])

  useEffect(() => {
    const supabase = createClient()

    const channel = supabase
      .channel('public:discussion_threads')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'discussion_threads' },
        async (payload) => {
          const id = (payload.new as { id: string }).id
          const { data } = await supabase
            .from('discussion_threads')
            .select(SELECT)
            .eq('id', id)
            .single<ThreadRow>()
          if (!data) return
          if (category !== 'all' && data.category !== category) return
          setThreads((prev) =>
            prev.some((t) => t.id === data.id) ? prev : [data, ...prev],
          )
        },
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'discussion_threads' },
        (payload) => {
          const updated = payload.new as Partial<ThreadRow> & { id: string }
          setThreads((prev) =>
            prev.map((t) => (t.id === updated.id ? { ...t, ...updated } : t)),
          )
        },
      )
      .subscribe((status) => {
        setConnected(status === 'SUBSCRIBED')
      })

    return () => {
      supabase.removeChannel(channel)
    }
  }, [category])

  return { threads, connected }
}
