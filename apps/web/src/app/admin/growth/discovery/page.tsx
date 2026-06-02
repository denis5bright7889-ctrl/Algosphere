import Link from 'next/link'
import { createClient as serviceClient } from '@supabase/supabase-js'
import { ArrowLeft } from 'lucide-react'
import DiscoveryClient from './DiscoveryClient'

export const metadata = { title: 'Discovery — Growth Engine' }
export const dynamic = 'force-dynamic'

function db() {
  return serviceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

interface Row {
  id:              string
  source:          string
  external_id:     string
  url:             string
  title:           string
  snippet:         string | null
  author:          string | null
  posted_at:       string | null
  topic_tags:      string[]
  status:          string
  ai_reply_draft:  string | null
  ai_reply_at:     string | null
  relevance:       number | null
  reviewed_at:     string | null
  created_at:      string
}

export default async function DiscoveryPage() {
  const { data } = await db()
    .from('growth_discovery_items')
    .select('id, source, external_id, url, title, snippet, author, posted_at, topic_tags, status, ai_reply_draft, ai_reply_at, relevance, reviewed_at, created_at')
    .in('status', ['queued','drafting'])
    .order('relevance', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(50)

  const items = (data ?? []) as Row[]

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href="/admin/growth" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-3.5 w-3.5" /> Back to Growth Engine
          </Link>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">Discovery</h1>
          <p className="mt-0.5 max-w-2xl text-xs text-muted-foreground">
            Public posts on Reddit matching the AlgoSphere topic set. Draft an AI reply, edit it, then open the original thread and post manually from the brand account. No automated posting to external platforms.
          </p>
        </div>
      </header>

      {items.length === 0 ? (
        <div className="rounded-2xl border border-border bg-card px-4 py-12 text-center text-sm text-muted-foreground">
          Queue is empty. The daily cron at 07:00 UTC runs the Reddit scan; you can also trigger it ad-hoc via `/api/cron/growth-discovery`.
        </div>
      ) : (
        <DiscoveryClient initial={items} />
      )}
    </div>
  )
}
