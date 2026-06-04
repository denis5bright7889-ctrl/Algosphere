'use client'

/**
 * MediaActions — operator panel on the Media Command Center.
 *
 *  1. Broadcast Now    — composes a quick text+link, fires it to a
 *                        selectable set of channels, immediately.
 *  2. Drain Queue Now  — calls /api/admin/growth/drain-queue, which
 *                        publishes every queued growth_scheduled_posts
 *                        row whose send_at is past — bypasses the
 *                        daily cron.
 *
 * Both surface their per-channel result inline so the operator sees
 * what actually went out.
 */
import { useState, useTransition } from 'react'
import { Loader2, Send, Megaphone, CheckCircle2, XCircle, ExternalLink } from 'lucide-react'

type Channel =
  | 'x' | 'telegram' | 'discord' | 'linkedin'
  | 'instagram' | 'facebook' | 'youtube' | 'whatsapp_channel'
  | 'instagram_reels' | 'youtube_shorts' | 'tiktok'

const ALL_CHANNELS: Channel[] = [
  'discord', 'telegram', 'facebook', 'instagram', 'linkedin',
  'x', 'youtube', 'whatsapp_channel', 'instagram_reels',
  'youtube_shorts', 'tiktok',
]

const DEFAULT_PRESET: Channel[] = ['discord', 'telegram', 'facebook', 'instagram', 'linkedin']

interface ChannelResult {
  channel:      string
  ok:           boolean
  external_url: string | null
  error:        string | null
}

export default function MediaActions() {
  const [title,    setTitle]    = useState('')
  const [body,     setBody]     = useState('')
  const [ctaUrl,   setCtaUrl]   = useState('https://algospherequant.com')
  const [picked,   setPicked]   = useState<Set<Channel>>(new Set(DEFAULT_PRESET))
  const [broadcast, setBroadcast] = useState<{
    content_id: string
    summary:    { total: number; succeeded: number; failed: number }
    results:    ChannelResult[]
  } | null>(null)
  const [drain, setDrain] = useState<{
    processed: number
    succeeded: number
    failed:    number
    note?:     string
    results?:  ChannelResult[]
  } | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const [active, setActive] = useState<'broadcast' | 'drain' | null>(null)

  function toggle(ch: Channel) {
    setPicked((cur) => {
      const next = new Set(cur)
      if (next.has(ch)) next.delete(ch); else next.add(ch)
      return next
    })
  }

  function doBroadcast() {
    setErr(null); setBroadcast(null); setActive('broadcast')
    if (!title.trim() || !body.trim() || picked.size === 0) {
      setErr('Title, body, and at least one channel are required.')
      return
    }
    start(async () => {
      const r = await fetch('/api/admin/growth/broadcast-now', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title:    title.trim(),
          body:     body.trim(),
          channels: Array.from(picked),
          cta_url:  ctaUrl.trim() || undefined,
        }),
      })
      const j = await r.json()
      if (!r.ok && r.status !== 207) {
        setErr(j.error ?? 'Broadcast failed')
        return
      }
      setBroadcast(j)
    })
  }

  function doDrain() {
    setErr(null); setDrain(null); setActive('drain')
    start(async () => {
      const r = await fetch('/api/admin/growth/drain-queue', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      const j = await r.json()
      if (!r.ok) { setErr(j.error ?? 'Drain failed'); return }
      setDrain(j)
    })
  }

  return (
    <section className="rounded-2xl border border-border bg-card p-4 space-y-4">
      <header className="flex items-center gap-2 text-sm font-semibold">
        <Megaphone className="size-4 text-amber-300" />
        Operator actions
      </header>

      {/* Drain Queue */}
      <div className="rounded-xl border border-border bg-background/40 p-3 space-y-2">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <p className="text-sm font-semibold">Drain queue now</p>
            <p className="text-xs text-muted-foreground">
              Publishes every queued scheduled_post whose send_at is past — bypasses the daily cron.
            </p>
          </div>
          <button
            type="button"
            onClick={doDrain}
            disabled={pending}
            className="inline-flex items-center gap-2 rounded-md bg-sky-500 px-4 py-2 text-xs font-bold text-black hover:bg-sky-400 disabled:opacity-50"
          >
            {pending && active === 'drain'
              ? <Loader2 className="size-3.5 animate-spin" />
              : <Send className="size-3.5" />}
            Drain now
          </button>
        </div>
        {drain && (
          <ResultsBlock
            title={`Drain processed ${drain.processed} (✓ ${drain.succeeded} · ✗ ${drain.failed})`}
            results={drain.results ?? []}
            note={drain.note}
          />
        )}
      </div>

      {/* Broadcast Now */}
      <div className="rounded-xl border border-border bg-background/40 p-3 space-y-3">
        <div>
          <p className="text-sm font-semibold">Broadcast now</p>
          <p className="text-xs text-muted-foreground">
            Compose a one-off message and push it to every selected channel immediately. Bypasses automation rules and asset waits.
          </p>
        </div>

        <input
          type="text"
          placeholder="Title (max 200 chars)"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={200}
          className="w-full rounded-md border border-border bg-background/60 px-3 py-2 text-sm placeholder:text-muted-foreground/60"
        />
        <textarea
          placeholder="Body (markdown OK)"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={4}
          maxLength={8000}
          className="w-full rounded-md border border-border bg-background/60 px-3 py-2 text-sm placeholder:text-muted-foreground/60"
        />
        <input
          type="url"
          placeholder="CTA URL"
          value={ctaUrl}
          onChange={(e) => setCtaUrl(e.target.value)}
          className="w-full rounded-md border border-border bg-background/60 px-3 py-2 text-sm placeholder:text-muted-foreground/60"
        />

        <div>
          <p className="mb-1.5 text-xs text-muted-foreground">Channels ({picked.size} selected)</p>
          <div className="flex flex-wrap gap-1.5">
            {ALL_CHANNELS.map((ch) => {
              const on = picked.has(ch)
              return (
                <button
                  key={ch}
                  type="button"
                  onClick={() => toggle(ch)}
                  className={
                    'rounded-md border px-2 py-1 text-[11px] font-semibold transition ' +
                    (on
                      ? 'border-amber-500/60 bg-amber-500/20 text-amber-200'
                      : 'border-border bg-background/60 text-muted-foreground hover:bg-accent/40')
                  }
                >
                  {ch}
                </button>
              )
            })}
          </div>
        </div>

        <button
          type="button"
          onClick={doBroadcast}
          disabled={pending}
          className="inline-flex items-center gap-2 rounded-md bg-amber-500 px-4 py-2 text-xs font-bold text-black hover:bg-amber-400 disabled:opacity-50"
        >
          {pending && active === 'broadcast'
            ? <Loader2 className="size-3.5 animate-spin" />
            : <Megaphone className="size-3.5" />}
          Broadcast to {picked.size} channels
        </button>

        {broadcast && (
          <ResultsBlock
            title={`Broadcast fired (✓ ${broadcast.summary.succeeded} · ✗ ${broadcast.summary.failed})`}
            results={broadcast.results}
            contentId={broadcast.content_id}
          />
        )}
      </div>

      {err && (
        <div className="rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
          {err}
        </div>
      )}
    </section>
  )
}

function ResultsBlock({
  title,
  results,
  contentId,
  note,
}: {
  title:      string
  results:    ChannelResult[]
  contentId?: string
  note?:      string
}) {
  return (
    <div className="rounded-md border border-border bg-background/40 p-3">
      <p className="mb-2 text-xs font-semibold">{title}</p>
      {note && <p className="mb-2 text-[11px] text-muted-foreground">{note}</p>}
      {contentId && (
        <p className="mb-2 text-[11px] text-muted-foreground">
          content_id: <code className="font-mono">{contentId.slice(0, 8)}</code>
        </p>
      )}
      {results.length === 0 ? (
        <p className="text-[11px] text-muted-foreground">No per-channel results.</p>
      ) : (
        <ul className="space-y-1 text-[11px]">
          {results.map((r, i) => (
            <li key={i} className="flex items-center gap-2 flex-wrap">
              {r.ok
                ? <CheckCircle2 className="size-3.5 text-emerald-300 shrink-0" />
                : <XCircle      className="size-3.5 text-rose-300 shrink-0" />}
              <span className="font-mono text-foreground">{r.channel}</span>
              {r.external_url ? (
                <a
                  href={r.external_url}
                  target="_blank"
                  rel="noopener"
                  className="inline-flex items-center gap-1 text-emerald-300 hover:underline truncate max-w-[260px]"
                >
                  view <ExternalLink className="size-3 shrink-0" />
                </a>
              ) : null}
              {r.error && <span className="text-rose-300/80 truncate">{r.error}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
