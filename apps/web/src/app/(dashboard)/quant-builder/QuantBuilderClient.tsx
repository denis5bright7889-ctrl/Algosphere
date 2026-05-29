'use client'
/**
 * /quant-builder client island (Refocus R5b).
 *
 * Three modes the user toggles between:
 *   1. LIST     — saved strategies on the left, picker / details on right
 *   2. NEW      — template chooser (or blank)
 *   3. EDIT     — block list with param controls + save / version history
 *
 * No drag-and-drop yet — block order is determined by category and the
 * user reorders by deleting + re-adding from the catalog. Drag/drop
 * arrives in a follow-up; the data shape supports it (instance ids
 * are stable).
 */
import { useCallback, useMemo, useState } from 'react'
import {
  Trash2, Plus, Save, History, RotateCcw, X,
  Loader2, FilePlus2, FileCode2, AlertOctagon, Sparkles, FlaskConical,
  GripVertical, Pencil, Check,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  BLOCK_CATALOG, BLOCK_BY_KEY, BLOCKS_BY_CATEGORY,
  validateStrategyConfig, blankConfig,
  type BlockKey, type BlockInstance, type StrategyConfig,
  type BlockCategory,
} from '@/lib/strategies/blocks'


export interface StrategyVersionRow {
  id:              string
  version_number:  number
  notes:           string | null
  config:          StrategyConfig
  created_at:      string
}


export interface StrategyRow {
  id:              string
  name:            string
  description:     string | null
  template_key:    string | null
  is_archived:     boolean
  head_version_id: string | null
  created_at:      string
  updated_at:      string
  head:            StrategyVersionRow | StrategyVersionRow[] | null
}


export interface TemplateCard {
  key:       string
  name:      string
  category:  string
  summary:   string
  timeframe: string
  pair_hint: string
}


type Mode =
  | { name: 'list' }
  | { name: 'new' }
  | { name: 'edit'; strategy: StrategyRow; config: StrategyConfig; dirty: boolean; versions: StrategyVersionRow[] }


export default function QuantBuilderClient({
  initialStrategies, templates,
}: {
  initialStrategies: StrategyRow[]
  templates:         TemplateCard[]
}) {
  const [strategies, setStrategies] = useState<StrategyRow[]>(initialStrategies)
  const [mode, setMode]             = useState<Mode>({ name: 'list' })
  const [busy, setBusy]             = useState(false)
  const [error, setError]           = useState<string | null>(null)

  const openStrategy = useCallback(async (s: StrategyRow) => {
    setBusy(true); setError(null)
    try {
      const r  = await fetch(`/api/strategies/${s.id}`, { cache: 'no-store' })
      const d  = await r.json()
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`)
      const head = (d.versions ?? []).find((v: StrategyVersionRow) => v.id === d.strategy.head_version_id)
        ?? d.versions?.[0] ?? null
      setMode({
        name:     'edit',
        strategy: d.strategy,
        config:   (head?.config as StrategyConfig) ?? blankConfig(),
        dirty:    false,
        versions: d.versions ?? [],
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to open')
    } finally { setBusy(false) }
  }, [])

  const createNew = useCallback(async (opts: { name: string; template_key?: string }) => {
    setBusy(true); setError(null)
    try {
      const r = await fetch('/api/strategies', {
        method:  'POST',
        headers: { 'content-type': 'application/json' },
        body:    JSON.stringify(opts),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`)

      const fresh = await fetch(`/api/strategies/${d.id}`, { cache: 'no-store' }).then((x) => x.json())
      setStrategies((arr) => [fresh.strategy, ...arr])
      const head = fresh.versions?.find((v: StrategyVersionRow) => v.id === fresh.strategy.head_version_id)
                ?? fresh.versions?.[0]
      setMode({
        name:     'edit',
        strategy: fresh.strategy,
        config:   (head?.config as StrategyConfig) ?? blankConfig(),
        dirty:    false,
        versions: fresh.versions ?? [],
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create')
    } finally { setBusy(false) }
  }, [])

  const saveVersion = useCallback(async (notes: string) => {
    if (mode.name !== 'edit') return
    setBusy(true); setError(null)
    try {
      const r = await fetch(`/api/strategies/${mode.strategy.id}`, {
        method:  'PATCH',
        headers: { 'content-type': 'application/json' },
        body:    JSON.stringify({ config: mode.config, notes }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`)
      const fresh = await fetch(`/api/strategies/${mode.strategy.id}`, { cache: 'no-store' }).then((x) => x.json())
      setMode({
        name:     'edit',
        strategy: fresh.strategy,
        config:   mode.config,
        dirty:    false,
        versions: fresh.versions ?? [],
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed')
    } finally { setBusy(false) }
  }, [mode])

  const rollback = useCallback(async (versionId: string) => {
    if (mode.name !== 'edit') return
    setBusy(true); setError(null)
    try {
      const r = await fetch(`/api/strategies/${mode.strategy.id}`, {
        method:  'PATCH',
        headers: { 'content-type': 'application/json' },
        body:    JSON.stringify({ rollback_to_version_id: versionId }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`)
      const fresh = await fetch(`/api/strategies/${mode.strategy.id}`, { cache: 'no-store' }).then((x) => x.json())
      const head = fresh.versions?.find((v: StrategyVersionRow) => v.id === fresh.strategy.head_version_id)
      setMode({
        name:     'edit',
        strategy: fresh.strategy,
        config:   (head?.config as StrategyConfig) ?? mode.config,
        dirty:    false,
        versions: fresh.versions ?? [],
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Rollback failed')
    } finally { setBusy(false) }
  }, [mode])

  const archive = useCallback(async () => {
    if (mode.name !== 'edit') return
    if (!confirm(`Archive "${mode.strategy.name}"? You can recover from version history later.`)) return
    setBusy(true); setError(null)
    try {
      const r = await fetch(`/api/strategies/${mode.strategy.id}`, { method: 'DELETE' })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`)
      setStrategies((arr) => arr.filter((s) => s.id !== mode.strategy.id))
      setMode({ name: 'list' })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Archive failed')
    } finally { setBusy(false) }
  }, [mode])

  const updateConfig = useCallback((updater: (c: StrategyConfig) => StrategyConfig) => {
    setMode((m) => m.name === 'edit'
      ? { ...m, config: updater(m.config), dirty: true }
      : m)
  }, [])

  /** Rename + redescribe (R5d). Sends a meta-only PATCH; doesn't create
   *  a new version. Optimistically updates the in-memory strategy and
   *  the list so the UI feels instant. */
  const renameStrategy = useCallback(async (next: { name?: string; description?: string }) => {
    if (mode.name !== 'edit') return
    const trimmedName = next.name?.trim()
    if (next.name != null && !trimmedName) {
      setError('Strategy name cannot be empty.')
      return
    }
    setBusy(true); setError(null)
    try {
      const r = await fetch(`/api/strategies/${mode.strategy.id}`, {
        method:  'PATCH',
        headers: { 'content-type': 'application/json' },
        body:    JSON.stringify({
          ...(trimmedName != null    ? { name: trimmedName } : {}),
          ...(next.description != null ? { description: next.description } : {}),
        }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`)
      const merged: StrategyRow = {
        ...mode.strategy,
        ...(trimmedName != null      ? { name: trimmedName } : {}),
        ...(next.description != null ? { description: next.description } : {}),
      }
      setMode({ ...mode, strategy: merged })
      setStrategies((arr) => arr.map((s) => s.id === merged.id ? merged : s))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Rename failed')
    } finally { setBusy(false) }
  }, [mode])

  return (
    <>
      {error && (
        <div className="surface mb-4 border-rose-500/40 bg-rose-500/[0.06] p-3 text-xs text-rose-200 flex items-center gap-2">
          <AlertOctagon className="h-4 w-4 shrink-0" /> {error}
        </div>
      )}

      {mode.name === 'list' && (
        <ListView strategies={strategies} onOpen={openStrategy} onNew={() => setMode({ name: 'new' })} busy={busy} />
      )}

      {mode.name === 'new' && (
        <NewView templates={templates} busy={busy} onCancel={() => setMode({ name: 'list' })} onCreate={createNew} />
      )}

      {mode.name === 'edit' && (
        <EditView
          strategy={mode.strategy}
          config={mode.config}
          dirty={mode.dirty}
          versions={mode.versions}
          busy={busy}
          onClose={() => setMode({ name: 'list' })}
          onMutate={updateConfig}
          onSave={saveVersion}
          onRollback={rollback}
          onArchive={archive}
          onRename={renameStrategy}
        />
      )}
    </>
  )
}


// ─── ListView ───────────────────────────────────────────────────────

function ListView({ strategies, onOpen, onNew, busy }: {
  strategies: StrategyRow[]
  onOpen:     (s: StrategyRow) => void
  onNew:      () => void
  busy:       boolean
}) {
  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-2">
        <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-bold">
          Your strategies · {strategies.length}
        </p>
        <button type="button" onClick={onNew} className="btn-premium inline-flex !px-4 !py-2 !text-xs" disabled={busy}>
          <FilePlus2 className="h-3.5 w-3.5" />
          New strategy
        </button>
      </div>

      {strategies.length === 0 ? (
        <div className="surface p-10 text-center">
          <FileCode2 className="mx-auto h-7 w-7 text-amber-300/80" strokeWidth={1.5} />
          <p className="mt-2 text-sm font-semibold">No strategies yet</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Clone a battle-tested template or compose your own from the block catalogue.
          </p>
          <button type="button" onClick={onNew} className="btn-premium mt-4 inline-flex !px-4 !py-2 !text-xs">
            <FilePlus2 className="h-3.5 w-3.5" /> Create your first
          </button>
        </div>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2">
          {strategies.map((s) => {
            const head = Array.isArray(s.head) ? s.head[0] : s.head
            const blockCount = head?.config?.blocks?.length ?? 0
            return (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => onOpen(s)}
                  className="surface w-full text-left p-4 hover:border-amber-500/40 transition-colors"
                >
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold truncate">{s.name}</h3>
                    {head && (
                      <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                        v{head.version_number}
                      </span>
                    )}
                  </div>
                  {s.description && (
                    <p className="mt-1 text-[11px] text-muted-foreground line-clamp-2">{s.description}</p>
                  )}
                  <p className="mt-2 font-mono text-[10px] tabular-nums text-muted-foreground/70">
                    {blockCount} block{blockCount === 1 ? '' : 's'} · updated {new Date(s.updated_at).toLocaleDateString()}
                  </p>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}


// ─── NewView (template picker) ──────────────────────────────────────

function NewView({ templates, busy, onCreate, onCancel }: {
  templates: TemplateCard[]
  busy:      boolean
  onCreate:  (opts: { name: string; template_key?: string }) => void
  onCancel:  () => void
}) {
  const [name, setName]     = useState('')
  const [chosen, setChosen] = useState<string | null>(null)

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-bold">
          Start from a template — or blank
        </p>
        <button type="button" onClick={onCancel} className="text-[12px] text-muted-foreground hover:text-foreground">
          Cancel
        </button>
      </div>

      <div className="surface mb-4 p-4">
        <label className="block text-[11px] uppercase tracking-wider text-muted-foreground font-bold mb-1.5">
          Strategy name
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. London Breakout v1"
          maxLength={80}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
        />
      </div>

      <ul className="grid gap-2 sm:grid-cols-2">
        <li>
          <button
            type="button"
            onClick={() => setChosen(null)}
            className={cn(
              'surface w-full p-4 text-left transition-colors',
              chosen === null ? 'border-amber-500/50' : 'hover:border-border/80',
            )}
          >
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-amber-300" />
              <span className="text-sm font-semibold">Blank</span>
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Start with just fixed-risk sizing. Add blocks one at a time.
            </p>
          </button>
        </li>
        {templates.map((t) => (
          <li key={t.key}>
            <button
              type="button"
              onClick={() => setChosen(t.key)}
              className={cn(
                'surface w-full p-4 text-left transition-colors',
                chosen === t.key ? 'border-amber-500/50' : 'hover:border-border/80',
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold">{t.name}</span>
                <span className="rounded border border-border bg-background/40 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-muted-foreground">
                  {t.category}
                </span>
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">{t.summary}</p>
              <p className="mt-1.5 font-mono text-[10px] text-muted-foreground/70">
                {t.pair_hint} · {t.timeframe}
              </p>
            </button>
          </li>
        ))}
      </ul>

      <button
        type="button"
        onClick={() => onCreate({ name: name.trim() || 'Untitled strategy', template_key: chosen ?? undefined })}
        disabled={busy}
        className="btn-premium mt-5 inline-flex !px-5 !py-2.5 !text-sm"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FilePlus2 className="h-4 w-4" />}
        Create strategy
      </button>
    </div>
  )
}


// ─── EditView ────────────────────────────────────────────────────────

function EditView({
  strategy, config, dirty, versions, busy,
  onClose, onMutate, onSave, onRollback, onArchive, onRename,
}: {
  strategy:   StrategyRow
  config:     StrategyConfig
  dirty:      boolean
  versions:   StrategyVersionRow[]
  busy:       boolean
  onClose:    () => void
  onMutate:   (updater: (c: StrategyConfig) => StrategyConfig) => void
  onSave:     (notes: string) => void
  onRollback: (versionId: string) => void
  onArchive:  () => void
  onRename:   (next: { name?: string; description?: string }) => void
}) {
  const [showHistory, setShowHistory] = useState(false)
  const [saveNotes,   setSaveNotes]   = useState('')
  const [showCatalog, setShowCatalog] = useState(false)
  const [editingMeta, setEditingMeta] = useState(false)
  const [draftName,        setDraftName]        = useState(strategy.name)
  const [draftDescription, setDraftDescription] = useState(strategy.description ?? '')

  const issues = useMemo(() => validateStrategyConfig(config).issues, [config])

  const addBlock = (key: BlockKey) => {
    const def = BLOCK_BY_KEY[key]
    if (!def) return
    onMutate((c) => ({
      ...c,
      blocks: [...c.blocks, {
        id:    crypto.randomUUID(),
        key,
        params: Object.fromEntries(def.params.map((p) => [p.key, p.default])),
      }],
    }))
    setShowCatalog(false)
  }

  const removeBlock = (id: string) => {
    onMutate((c) => ({ ...c, blocks: c.blocks.filter((b) => b.id !== id) }))
  }

  const updateBlockParam = (id: string, paramKey: string, value: number | string | boolean) => {
    onMutate((c) => ({
      ...c,
      blocks: c.blocks.map((b) =>
        b.id === id ? { ...b, params: { ...b.params, [paramKey]: value } } : b,
      ),
    }))
  }

  // Drag-and-drop reorder. Plain HTML5 drag API — no library needed for
  // a vertical list with stable instance ids. Source id is carried in
  // dataTransfer; drop target re-orders the array by computing the
  // source/target indices.
  const moveBlock = (sourceId: string, targetId: string) => {
    if (sourceId === targetId) return
    onMutate((c) => {
      const arr = [...c.blocks]
      const from = arr.findIndex((b) => b.id === sourceId)
      const to   = arr.findIndex((b) => b.id === targetId)
      if (from < 0 || to < 0) return c
      const [moved] = arr.splice(from, 1)
      if (!moved) return c
      arr.splice(to, 0, moved)
      return { ...c, blocks: arr }
    })
  }

  const headVersion = Array.isArray(strategy.head) ? strategy.head[0] : strategy.head

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <button type="button" onClick={onClose} className="text-[12px] text-muted-foreground hover:text-foreground">
          ← All strategies
        </button>
        <div className="flex items-center gap-2">
          <a
            href={`/backtest?strategy_id=${strategy.id}`}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md border border-amber-500/50 bg-amber-500/10 px-2.5 py-1 text-[11px] font-semibold text-amber-200 hover:bg-amber-500/15',
              dirty && 'opacity-60',
            )}
            title={dirty ? 'Save first to backtest the latest config' : 'Backtest the head version'}
          >
            <FlaskConical className="h-3.5 w-3.5" /> Backtest
          </a>
          <button
            type="button"
            onClick={() => setShowHistory((v) => !v)}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background/60 px-2.5 py-1 text-[11px] font-semibold text-foreground/85 hover:text-foreground"
          >
            <History className="h-3.5 w-3.5" /> {versions.length} version{versions.length === 1 ? '' : 's'}
          </button>
          <button
            type="button"
            onClick={onArchive}
            className="inline-flex items-center gap-1.5 rounded-md border border-rose-500/40 bg-rose-500/10 px-2.5 py-1 text-[11px] font-semibold text-rose-200 hover:bg-rose-500/15"
            disabled={busy}
          >
            <Trash2 className="h-3.5 w-3.5" /> Archive
          </button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="space-y-3">
          <div className="surface p-4">
            {editingMeta ? (
              <div className="space-y-2">
                <input
                  type="text"
                  value={draftName}
                  onChange={(e) => setDraftName(e.target.value)}
                  maxLength={80}
                  aria-label="Strategy name"
                  className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-base font-semibold"
                />
                <textarea
                  value={draftDescription}
                  onChange={(e) => setDraftDescription(e.target.value)}
                  maxLength={500}
                  placeholder="One-line description (optional)"
                  aria-label="Strategy description"
                  className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-[12px] resize-none"
                  rows={2}
                />
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      onRename({ name: draftName, description: draftDescription })
                      setEditingMeta(false)
                    }}
                    disabled={busy || !draftName.trim()}
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-md border border-emerald-500/50 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-semibold text-emerald-200 hover:bg-emerald-500/15',
                      (busy || !draftName.trim()) && 'opacity-50 cursor-not-allowed',
                    )}
                  >
                    <Check className="h-3.5 w-3.5" /> Save
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setDraftName(strategy.name)
                      setDraftDescription(strategy.description ?? '')
                      setEditingMeta(false)
                    }}
                    className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background/60 px-2.5 py-1 text-[11px] font-semibold text-foreground/85 hover:text-foreground"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="flex items-start justify-between gap-2">
                  <h2 className="text-base font-semibold">{strategy.name}</h2>
                  <button
                    type="button"
                    onClick={() => {
                      setDraftName(strategy.name)
                      setDraftDescription(strategy.description ?? '')
                      setEditingMeta(true)
                    }}
                    aria-label="Edit strategy name and description"
                    className="text-muted-foreground/70 hover:text-foreground"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                </div>
                {strategy.description && (
                  <p className="mt-1 text-[12px] text-muted-foreground">{strategy.description}</p>
                )}
              </>
            )}
            <p className="mt-2 font-mono text-[10px] text-muted-foreground/70">
              {config.blocks.length} block{config.blocks.length === 1 ? '' : 's'}
              {headVersion ? ` · head v${headVersion.version_number}` : ''}
            </p>
          </div>

          {config.blocks.map((b, i) => (
            <BlockCard
              key={b.id}
              instance={b}
              index={i + 1}
              onRemove={() => removeBlock(b.id)}
              onParamChange={(paramKey, value) => updateBlockParam(b.id, paramKey, value)}
              onMove={moveBlock}
            />
          ))}

          {!showCatalog ? (
            <button
              type="button"
              onClick={() => setShowCatalog(true)}
              className="w-full rounded-2xl border-2 border-dashed border-border bg-background/30 p-4 text-center text-xs text-muted-foreground hover:border-amber-500/40 hover:text-foreground"
            >
              <Plus className="mx-auto h-4 w-4" /> Add block
            </button>
          ) : (
            <CatalogPicker onPick={addBlock} onCancel={() => setShowCatalog(false)} />
          )}

          {issues.length > 0 && (
            <div className="surface border-amber-500/30 bg-amber-500/[0.04] p-3">
              <p className="text-[10px] uppercase tracking-wider text-amber-300 font-bold">
                Validation
              </p>
              <ul className="mt-1 text-[11px] text-amber-200 space-y-0.5">
                {issues.slice(0, 5).map((m, i) => <li key={i}>· {m}</li>)}
              </ul>
            </div>
          )}

          <div className="surface p-3 flex flex-wrap items-end gap-2">
            <label className="flex-1 min-w-[160px]">
              <span className="block text-[10px] uppercase tracking-wider text-muted-foreground">
                Save notes (optional)
              </span>
              <input
                type="text"
                value={saveNotes}
                onChange={(e) => setSaveNotes(e.target.value)}
                placeholder="e.g. tightened RSI band"
                maxLength={120}
                className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-[12px]"
              />
            </label>
            <button
              type="button"
              onClick={() => { onSave(saveNotes); setSaveNotes('') }}
              disabled={busy || !dirty}
              className={cn(
                'btn-premium inline-flex !px-4 !py-2 !text-xs',
                (!dirty || busy) && 'opacity-50 cursor-not-allowed',
              )}
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
              {dirty ? 'Save version' : 'No changes'}
            </button>
          </div>
        </div>

        {showHistory && (
          <aside className="surface p-3 h-fit lg:sticky lg:top-4">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-[11px] uppercase tracking-wider text-muted-foreground font-bold">History</h3>
              <button type="button" onClick={() => setShowHistory(false)} aria-label="Close history" className="text-muted-foreground hover:text-foreground">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            <ul className="space-y-1.5">
              {versions.map((v) => {
                const isHead = v.id === strategy.head_version_id
                return (
                  <li key={v.id} className={cn(
                    'rounded-lg border p-2',
                    isHead ? 'border-amber-500/50 bg-amber-500/[0.06]' : 'border-border bg-background/40',
                  )}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-[11px] font-semibold">v{v.version_number}</span>
                      {!isHead && (
                        <button
                          type="button"
                          onClick={() => onRollback(v.id)}
                          className="inline-flex items-center gap-1 text-[10px] text-amber-300 hover:underline"
                          disabled={busy}
                        >
                          <RotateCcw className="h-2.5 w-2.5" /> Restore
                        </button>
                      )}
                    </div>
                    {v.notes && <p className="mt-0.5 text-[10px] text-muted-foreground">{v.notes}</p>}
                    <p className="mt-0.5 font-mono text-[9px] text-muted-foreground/60">
                      {v.config.blocks.length} blocks · {new Date(v.created_at).toLocaleString()}
                    </p>
                  </li>
                )
              })}
            </ul>
          </aside>
        )}
      </div>
    </div>
  )
}


// ─── BlockCard ──────────────────────────────────────────────────────

function BlockCard({ instance, index, onRemove, onParamChange, onMove }: {
  instance: BlockInstance
  index:    number
  onRemove: () => void
  onParamChange: (paramKey: string, value: number | string | boolean) => void
  onMove:   (sourceId: string, targetId: string) => void
}) {
  const def = BLOCK_BY_KEY[instance.key]
  const [dragOver, setDragOver] = useState(false)

  if (!def) {
    return (
      <div className="surface border-rose-500/40 bg-rose-500/[0.04] p-3 text-xs text-rose-200">
        Unknown block &quot;{instance.key}&quot; — remove to continue.
        <button type="button" onClick={onRemove} className="ml-2 text-rose-300 underline">remove</button>
      </div>
    )
  }
  return (
    <div
      className={cn('surface p-3 transition-colors', dragOver && 'border-amber-500/60 bg-amber-500/[0.04]')}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragOver(false)
        const src = e.dataTransfer.getData('text/block-id')
        if (src && src !== instance.id) onMove(src, instance.id)
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className="cursor-grab active:cursor-grabbing text-muted-foreground/60 hover:text-foreground"
            draggable
            onDragStart={(e) => { e.dataTransfer.setData('text/block-id', instance.id) }}
            aria-label={`Drag ${def.label}`}
            title="Drag to reorder"
          >
            <GripVertical className="h-3.5 w-3.5" />
          </span>
          <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-amber-500/15 text-[10px] font-bold text-amber-300">
            {index}
          </span>
          <h4 className="text-sm font-semibold truncate">{def.label}</h4>
          <span className="rounded border border-border bg-background/40 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-muted-foreground">
            {def.category}
          </span>
        </div>
        <button type="button" onClick={onRemove} aria-label={`Remove ${def.label}`} className="text-muted-foreground hover:text-rose-300">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">{def.summary}</p>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        {def.params.map((p) => (
          <ParamControl
            key={p.key}
            param={p}
            value={instance.params[p.key] ?? p.default}
            onChange={(v) => onParamChange(p.key, v)}
          />
        ))}
      </div>
    </div>
  )
}


function ParamControl({ param, value, onChange }: {
  param:  typeof BLOCK_CATALOG[number]['params'][number]
  value:  number | string | boolean
  onChange: (v: number | string | boolean) => void
}) {
  return (
    <label className="block">
      <span className="block text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
        {param.label}
      </span>
      {param.kind === 'enum' && param.options ? (
        <select
          value={String(value)}
          onChange={(e) => onChange(e.target.value)}
          className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1 text-[12px]"
        >
          {param.options.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
        </select>
      ) : param.kind === 'bool' ? (
        <button
          type="button"
          onClick={() => onChange(!value)}
          className={cn(
            'mt-1 inline-flex items-center gap-2 rounded-md border px-2 py-1 text-[12px]',
            value ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-300' : 'border-border text-muted-foreground',
          )}
        >
          {value ? 'On' : 'Off'}
        </button>
      ) : (
        <input
          type="number"
          value={Number(value)}
          step={param.step ?? (param.kind === 'int' ? 1 : 0.1)}
          min={param.min}
          max={param.max}
          onChange={(e) => onChange(Number(e.target.value))}
          className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1 text-[12px] tabular-nums"
        />
      )}
    </label>
  )
}


// ─── CatalogPicker ─────────────────────────────────────────────────

function CatalogPicker({ onPick, onCancel }: {
  onPick:   (key: BlockKey) => void
  onCancel: () => void
}) {
  const categories: BlockCategory[] = ['indicators','price_action','smart_money','session','volatility','risk','ai']
  const labels: Record<BlockCategory, string> = {
    indicators:    'Indicators',
    price_action:  'Price Action',
    smart_money:   'Smart Money',
    session:       'Session',
    volatility:    'Volatility',
    risk:          'Risk',
    ai:            'AI Conditions',
  }

  return (
    <div className="surface p-3">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold">Add block</h3>
        <button type="button" onClick={onCancel} aria-label="Close catalogue" className="text-muted-foreground hover:text-foreground">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {categories.map((cat) => (
          BLOCKS_BY_CATEGORY[cat] && BLOCKS_BY_CATEGORY[cat].length > 0 ? (
            <section key={cat}>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">{labels[cat]}</p>
              <ul className="mt-1 space-y-1">
                {BLOCKS_BY_CATEGORY[cat].map((b) => (
                  <li key={b.key}>
                    <button
                      type="button"
                      onClick={() => onPick(b.key as BlockKey)}
                      className="w-full rounded-md border border-border bg-background/40 p-2 text-left hover:border-amber-500/40"
                    >
                      <p className="text-[12px] font-semibold">{b.label}</p>
                      <p className="text-[10px] text-muted-foreground">{b.summary}</p>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ) : null
        ))}
      </div>
    </div>
  )
}
