'use client'
/**
 * CommunitiesManager — the interactive surface on /admin/communities.
 *
 * Renders the table of all communities + an inline create/edit form.
 * Drives every action through fetch against /api/admin/communities/*.
 * No optimistic UI — each mutation reloads the row state from the
 * server so the table never lies about persisted state.
 */
import { useCallback, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Pin, Star, ExternalLink, Pencil, Trash2, RotateCcw,
  Plus, Loader2, AlertOctagon, Crown,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  COMMUNITY_KINDS, COMMUNITY_CATEGORIES, COMMUNITY_VISIBILITIES,
  type TelegramCommunity, type CommunityCategory, type CommunityKind,
  normalizeSlug,
} from '@/lib/telegram-communities'
import type { SubscriptionTier } from '@/lib/types'

interface Props {
  initial: TelegramCommunity[]
}

type FormState = {
  id?:           string
  slug:          string
  name:          string
  description:   string
  telegram_url:  string
  kind:          CommunityKind
  category:      CommunityCategory
  visibility:    SubscriptionTier
  is_featured:   boolean
  is_pinned:     boolean
  sort_order:    number
  icon_url:      string
  banner_url:    string
  member_count:  string  // text in the form, parsed before send
}

const EMPTY_FORM: FormState = {
  slug: '', name: '', description: '', telegram_url: '',
  kind: 'group', category: 'discussion', visibility: 'free',
  is_featured: false, is_pinned: false, sort_order: 100,
  icon_url: '', banner_url: '', member_count: '',
}

const INPUT_CLS = 'w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring'

export default function CommunitiesManager({ initial }: Props) {
  const router = useRouter()
  const [rows, setRows]       = useState<TelegramCommunity[]>(initial)
  const [form, setForm]       = useState<FormState>(EMPTY_FORM)
  const [editing, setEditing] = useState<string | null>(null)
  const [busy, setBusy]       = useState(false)
  const [err, setErr]         = useState<string | null>(null)
  const [showForm, setShow]   = useState(false)

  const reset = useCallback(() => {
    setForm(EMPTY_FORM)
    setEditing(null)
    setShow(false)
    setErr(null)
  }, [])

  const startEdit = useCallback((c: TelegramCommunity) => {
    setForm({
      id:           c.id,
      slug:         c.slug,
      name:         c.name,
      description:  c.description ?? '',
      telegram_url: c.telegram_url,
      kind:         c.kind,
      category:     c.category,
      visibility:   c.visibility,
      is_featured:  c.is_featured,
      is_pinned:    c.is_pinned,
      sort_order:   c.sort_order,
      icon_url:     c.icon_url ?? '',
      banner_url:   c.banner_url ?? '',
      member_count: c.member_count == null ? '' : String(c.member_count),
    })
    setEditing(c.id)
    setShow(true)
    setErr(null)
  }, [])

  const reload = useCallback(async () => {
    const r = await fetch('/api/admin/communities?include_archived=true', { cache: 'no-store' })
    const j = await r.json().catch(() => ({}))
    if (r.ok && Array.isArray(j?.communities)) setRows(j.communities)
  }, [])

  const submit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault()
    setErr(null)
    setBusy(true)
    const payload = {
      slug:         normalizeSlug(form.slug || form.name),
      name:         form.name,
      description:  form.description || null,
      telegram_url: form.telegram_url,
      kind:         form.kind,
      category:     form.category,
      visibility:   form.visibility,
      is_featured:  form.is_featured,
      is_pinned:    form.is_pinned,
      sort_order:   form.sort_order,
      icon_url:     form.icon_url || null,
      banner_url:   form.banner_url || null,
      member_count: form.member_count.trim() === '' ? null : Number(form.member_count),
    }
    try {
      const url    = editing ? `/api/admin/communities/${editing}` : '/api/admin/communities'
      const method = editing ? 'PATCH' : 'POST'
      const r = await fetch(url, {
        method,
        headers: { 'content-type': 'application/json' },
        body:    JSON.stringify(payload),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j?.detail || j?.error || `HTTP ${r.status}`)
      reset()
      await reload()
      router.refresh()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'save failed')
    } finally {
      setBusy(false)
    }
  }, [editing, form, reset, reload, router])

  const archive = useCallback(async (id: string) => {
    if (!confirm('Archive this community? It will hide from /communities. Use the Restore button to bring it back.')) return
    setBusy(true)
    try {
      const r = await fetch(`/api/admin/communities/${id}`, { method: 'DELETE' })
      if (!r.ok) throw new Error(`archive failed (${r.status})`)
      await reload()
      router.refresh()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'archive failed')
    } finally {
      setBusy(false)
    }
  }, [reload, router])

  const restore = useCallback(async (id: string) => {
    setBusy(true)
    try {
      const r = await fetch(`/api/admin/communities/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body:    JSON.stringify({ unarchive: true }),
      })
      if (!r.ok) throw new Error(`restore failed (${r.status})`)
      await reload()
      router.refresh()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'restore failed')
    } finally {
      setBusy(false)
    }
  }, [reload, router])

  const togglePin = useCallback(async (c: TelegramCommunity) => {
    setBusy(true)
    try {
      const r = await fetch(`/api/admin/communities/${c.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body:    JSON.stringify({ is_pinned: !c.is_pinned }),
      })
      if (!r.ok) throw new Error(`toggle failed (${r.status})`)
      await reload()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'toggle failed')
    } finally {
      setBusy(false)
    }
  }, [reload])

  return (
    <div className="space-y-4">
      {/* Action bar */}
      <div className="flex items-center justify-between gap-2">
        {!showForm && (
          <button
            type="button"
            onClick={() => { reset(); setShow(true) }}
            className="btn-premium inline-flex !px-3 !py-1.5 !text-xs"
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={2.25} />
            New community
          </button>
        )}
        {err && (
          <span className="inline-flex items-center gap-1.5 rounded-md border border-rose-500/40 bg-rose-500/10 px-2 py-1 text-[11px] text-rose-300">
            <AlertOctagon className="h-3 w-3" />
            {err}
          </span>
        )}
      </div>

      {showForm && (
        <form onSubmit={submit} className="surface p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">
              {editing ? 'Edit community' : 'New community'}
            </h3>
            <button
              type="button"
              onClick={reset}
              className="text-[11px] text-muted-foreground hover:text-foreground"
            >
              Cancel
            </button>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name *">
              <input
                required
                aria-label="Name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className={INPUT_CLS}
                placeholder="Pro Trader VIP"
              />
            </Field>
            <Field label="Slug (auto from name if blank)">
              <input
                aria-label="Slug"
                value={form.slug}
                onChange={(e) => setForm({ ...form, slug: e.target.value })}
                className={cn(INPUT_CLS, 'font-mono')}
                placeholder="pro-trader-vip"
              />
            </Field>
            <Field label="Telegram URL *">
              <input
                required
                aria-label="Telegram URL"
                value={form.telegram_url}
                onChange={(e) => setForm({ ...form, telegram_url: e.target.value })}
                className={cn(INPUT_CLS, 'font-mono')}
                placeholder="https://t.me/your-channel"
              />
            </Field>
            <Field label="Kind">
              <select
                aria-label="Kind"
                value={form.kind}
                onChange={(e) => setForm({ ...form, kind: e.target.value as CommunityKind })}
                className={INPUT_CLS}
              >
                {COMMUNITY_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
              </select>
            </Field>
            <Field label="Category">
              <select
                aria-label="Category"
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value as CommunityCategory })}
                className={INPUT_CLS}
              >
                {COMMUNITY_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </Field>
            <Field label="Visibility">
              <select
                aria-label="Visibility tier"
                value={form.visibility}
                onChange={(e) => setForm({ ...form, visibility: e.target.value as SubscriptionTier })}
                className={INPUT_CLS}
              >
                {COMMUNITY_VISIBILITIES.map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
            </Field>
            <Field label="Sort order (lower = earlier)">
              <input
                type="number"
                aria-label="Sort order"
                placeholder="100"
                min={0}
                max={10000}
                value={form.sort_order}
                onChange={(e) => setForm({ ...form, sort_order: Number(e.target.value) || 0 })}
                className={cn(INPUT_CLS, 'tabular-nums')}
              />
            </Field>
            <Field label="Member count (optional)">
              <input
                type="number"
                aria-label="Member count"
                min={0}
                value={form.member_count}
                onChange={(e) => setForm({ ...form, member_count: e.target.value })}
                className={cn(INPUT_CLS, 'tabular-nums')}
                placeholder="0"
              />
            </Field>
            <Field label="Icon URL (optional)" className="sm:col-span-2">
              <input
                type="url"
                aria-label="Icon URL"
                value={form.icon_url}
                onChange={(e) => setForm({ ...form, icon_url: e.target.value })}
                className={cn(INPUT_CLS, 'font-mono')}
                placeholder="https://..."
              />
            </Field>
            <Field label="Banner URL (optional)" className="sm:col-span-2">
              <input
                type="url"
                aria-label="Banner URL"
                value={form.banner_url}
                onChange={(e) => setForm({ ...form, banner_url: e.target.value })}
                className={cn(INPUT_CLS, 'font-mono')}
                placeholder="https://..."
              />
            </Field>
            <Field label="Description" className="sm:col-span-2">
              <textarea
                aria-label="Description"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                rows={3}
                maxLength={500}
                className={INPUT_CLS}
                placeholder="Short blurb shown on the community card."
              />
            </Field>
          </div>

          <div className="flex flex-wrap gap-4 pt-1">
            <label className="inline-flex items-center gap-2 text-[12px]">
              <input
                type="checkbox"
                checked={form.is_pinned}
                onChange={(e) => setForm({ ...form, is_pinned: e.target.checked })}
              />
              Pin to top
            </label>
            <label className="inline-flex items-center gap-2 text-[12px]">
              <input
                type="checkbox"
                checked={form.is_featured}
                onChange={(e) => setForm({ ...form, is_featured: e.target.checked })}
              />
              Featured
            </label>
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={reset}
              className="rounded-md border border-border bg-background/60 px-3 py-1.5 text-xs font-semibold text-foreground/85"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy}
              className="btn-premium inline-flex !px-3 !py-1.5 !text-xs disabled:opacity-50"
            >
              {busy
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                : <Crown className="h-3.5 w-3.5" strokeWidth={2.25} />}
              {editing ? 'Save changes' : 'Create'}
            </button>
          </div>
        </form>
      )}

      {/* Table */}
      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full min-w-[720px] text-[12px]">
          <thead className="bg-muted/30 text-left text-[10px] uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">Slug</th>
              <th className="px-3 py-2">Kind / Cat</th>
              <th className="px-3 py-2">Visibility</th>
              <th className="px-3 py-2 text-right">Order</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">
                  No communities yet.
                </td>
              </tr>
            ) : rows.map((c) => (
              <tr key={c.id} className={cn(
                'border-t border-border/40',
                c.archived_at && 'opacity-60',
              )}>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-1.5">
                    {c.is_pinned && (
                      <Pin className="h-3 w-3 shrink-0 text-amber-300" strokeWidth={2} />
                    )}
                    {c.is_featured && (
                      <Star className="h-3 w-3 shrink-0 text-amber-300" strokeWidth={2} />
                    )}
                    <span className="font-semibold">{c.name}</span>
                  </div>
                  {c.description && (
                    <div className="text-[10px] text-muted-foreground line-clamp-1 mt-0.5">
                      {c.description}
                    </div>
                  )}
                </td>
                <td className="px-3 py-2 font-mono text-[11px] text-muted-foreground">{c.slug}</td>
                <td className="px-3 py-2">
                  <div className="text-[11px]">{c.kind}</div>
                  <div className="text-[10px] text-muted-foreground">{c.category}</div>
                </td>
                <td className="px-3 py-2 font-semibold uppercase tracking-wider text-[10px]">
                  {c.visibility}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                  {c.sort_order}
                </td>
                <td className="px-3 py-2 text-[10px] uppercase tracking-wider">
                  {c.archived_at
                    ? <span className="text-rose-300">archived</span>
                    : <span className="text-emerald-300">active</span>}
                </td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap justify-end gap-1">
                    <a
                      href={c.telegram_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      title="Open on Telegram"
                      className="rounded border border-border bg-background/60 p-1 hover:text-foreground"
                    >
                      <ExternalLink className="h-3 w-3" />
                    </a>
                    {!c.archived_at && (
                      <button
                        type="button"
                        title={c.is_pinned ? 'Unpin' : 'Pin'}
                        onClick={() => togglePin(c)}
                        className={cn(
                          'rounded border p-1',
                          c.is_pinned
                            ? 'border-amber-500/40 bg-amber-500/10 text-amber-300'
                            : 'border-border bg-background/60',
                        )}
                      >
                        <Pin className="h-3 w-3" />
                      </button>
                    )}
                    <button
                      type="button"
                      title="Edit"
                      onClick={() => startEdit(c)}
                      className="rounded border border-border bg-background/60 p-1 hover:text-foreground"
                    >
                      <Pencil className="h-3 w-3" />
                    </button>
                    {c.archived_at ? (
                      <button
                        type="button"
                        title="Restore"
                        onClick={() => restore(c.id)}
                        className="rounded border border-emerald-500/40 bg-emerald-500/10 p-1 text-emerald-300"
                      >
                        <RotateCcw className="h-3 w-3" />
                      </button>
                    ) : (
                      <button
                        type="button"
                        title="Archive"
                        onClick={() => archive(c.id)}
                        className="rounded border border-rose-500/40 bg-rose-500/10 p-1 text-rose-300"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Field({ label, children, className }: {
  label: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <label className={cn('block', className)}>
      <span className="block text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground mb-1">
        {label}
      </span>
      {children}
    </label>
  )
}
