'use client'

import { useEffect, useState, useTransition } from 'react'
import { Send, ExternalLink, AlertOctagon } from 'lucide-react'
import { useRouter } from 'next/navigation'

const CHANNELS: { key: ChannelKey; label: string; wired: boolean }[] = [
  { key: 'telegram',         label: 'Telegram',         wired: true  },
  { key: 'x',                label: 'X (Twitter)',      wired: false },
  { key: 'discord',          label: 'Discord',          wired: false },
  { key: 'linkedin',         label: 'LinkedIn',         wired: false },
  { key: 'instagram',        label: 'Instagram',        wired: false },
  { key: 'facebook',         label: 'Facebook',         wired: false },
  { key: 'youtube',          label: 'YouTube',          wired: false },
  { key: 'whatsapp_channel', label: 'WhatsApp Channel', wired: false },
]

type ChannelKey =
  | 'x' | 'telegram' | 'discord' | 'linkedin'
  | 'instagram' | 'facebook' | 'youtube' | 'whatsapp_channel'
  | 'instagram_reels' | 'youtube_shorts'

interface ScheduledRow {
  id:           string
  channel:      string
  status:       string
  send_at:      string
  posted_at:    string | null
  external_url: string | null
  last_error:   string | null
}

export default function SchedulePanel({ contentId, status, disclaimer }: {
  contentId:  string
  status:     string
  disclaimer: string | null
}) {
  const router = useRouter()
  const [selected, setSelected] = useState<Record<ChannelKey, boolean>>({} as Record<ChannelKey, boolean>)
  const [sendAt, setSendAt]     = useState<string>('')
  const [rows, setRows]         = useState<ScheduledRow[]>([])
  const [error, setError]       = useState<string | null>(null)
  const [pending, start]        = useTransition()

  useEffect(() => {
    fetch(`/api/admin/growth/calendar?content_id=${contentId}`)
      .then(r => r.json())
      .then(j => setRows(j.data ?? []))
      .catch(() => {})
  }, [contentId])

  const ready = ['approved', 'scheduled', 'published'].includes(status) && !!disclaimer?.trim()

  const channels = (Object.keys(selected) as ChannelKey[]).filter((k) => selected[k])

  async function schedule() {
    setError(null)
    if (channels.length === 0) {
      setError('Pick at least one channel.')
      return
    }
    start(async () => {
      const res = await fetch('/api/admin/growth/schedule', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          content_id: contentId,
          channels,
          send_at:    sendAt ? new Date(sendAt).toISOString() : undefined,
        }),
      })
      const json = await res.json()
      if (!res.ok) { setError(json.error ?? 'Schedule failed'); return }
      setSelected({} as Record<ChannelKey, boolean>)
      setSendAt('')
      const refreshed = await fetch(`/api/admin/growth/calendar?content_id=${contentId}`).then(r => r.json())
      setRows(refreshed.data ?? [])
      router.refresh()
    })
  }

  async function postNow(id: string) {
    setError(null)
    start(async () => {
      const res = await fetch('/api/admin/growth/post-now', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ scheduled_id: id }),
      })
      const json = await res.json()
      if (!json.ok) { setError(json.error ?? 'Post failed'); }
      const refreshed = await fetch(`/api/admin/growth/calendar?content_id=${contentId}`).then(r => r.json())
      setRows(refreshed.data ?? [])
      router.refresh()
    })
  }

  return (
    <div className="rounded-2xl border border-border bg-card p-5 space-y-4">
      <header className="flex items-center gap-2">
        <Send className="h-4 w-4 text-amber-300" strokeWidth={1.75} aria-hidden />
        <h2 className="text-sm font-bold">Schedule + publish</h2>
        {!ready && (
          <span className="ml-auto rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-300">
            {!disclaimer?.trim() ? 'Disclaimer required' : `Status: ${status}`}
          </span>
        )}
      </header>

      {!ready && (
        <p className="text-[12px] text-amber-200">
          Approve the content and set a non-empty disclaimer before scheduling.
        </p>
      )}

      {ready && (
        <div className="space-y-3">
          <div>
            <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Channels</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {CHANNELS.map(({ key, label, wired }) => (
                <label key={key} className={
                  'flex items-center gap-2 rounded-md border px-2.5 py-2 text-[12px] cursor-pointer ' +
                  (selected[key]
                    ? 'border-amber-500/50 bg-amber-500/10'
                    : 'border-border bg-background hover:bg-accent/40')
                }>
                  <input
                    type="checkbox"
                    checked={!!selected[key]}
                    onChange={(e) => setSelected(s => ({ ...s, [key]: e.target.checked }))}
                  />
                  <span className="flex-1">{label}</span>
                  {wired
                    ? <span className="text-[9px] font-bold text-emerald-300">LIVE</span>
                    : <span className="text-[9px] font-bold text-zinc-400">STUB</span>}
                </label>
              ))}
            </div>
          </div>

          <label className="block">
            <span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Send at (leave empty for "now")</span>
            <input
              type="datetime-local"
              value={sendAt}
              onChange={(e) => setSendAt(e.target.value)}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            />
          </label>

          <button
            type="button"
            onClick={schedule}
            disabled={pending || channels.length === 0}
            className="inline-flex items-center gap-2 rounded-md bg-amber-500 px-4 py-2 text-xs font-bold text-black hover:bg-amber-400 disabled:opacity-50"
          >
            {pending ? 'Scheduling…' : `Schedule on ${channels.length || 0} channel${channels.length === 1 ? '' : 's'}`}
          </button>
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-[12px] text-rose-200">
          <AlertOctagon className="mr-1 inline h-3.5 w-3.5" /> {error}
        </div>
      )}

      {rows.length > 0 && (
        <div className="pt-3 border-t border-border/60">
          <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            Schedule log ({rows.length})
          </p>
          <ul className="space-y-1.5">
            {rows.map((r) => (
              <li key={r.id} className="flex items-center gap-2 text-[12px]">
                <span className="rounded-md border border-border px-2 py-0.5 text-[10px] uppercase font-bold">{r.channel}</span>
                <span className={
                  'rounded-md border px-2 py-0.5 text-[10px] uppercase font-bold ' + (
                    r.status === 'queued'  ? 'border-amber-500/40 text-amber-300' :
                    r.status === 'posted'  ? 'border-emerald-500/40 text-emerald-200' :
                    r.status === 'failed'  ? 'border-rose-500/40 text-rose-300' :
                    'border-border text-muted-foreground'
                  )
                }>
                  {r.status}
                </span>
                <span className="text-muted-foreground">{new Date(r.send_at).toLocaleString()}</span>
                {r.external_url && (
                  <a href={r.external_url} target="_blank" rel="noopener" className="inline-flex items-center gap-1 text-emerald-300 hover:underline">
                    open <ExternalLink className="h-3 w-3" />
                  </a>
                )}
                {r.status === 'queued' && (
                  <button
                    type="button"
                    onClick={() => postNow(r.id)}
                    disabled={pending}
                    className="ml-auto rounded-md bg-emerald-500/20 px-2 py-0.5 text-[10px] font-bold text-emerald-200 hover:bg-emerald-500/30 disabled:opacity-50"
                  >
                    Post now
                  </button>
                )}
                {r.last_error && (
                  <span className="ml-2 max-w-[260px] truncate text-[11px] text-rose-300/80">{r.last_error}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
