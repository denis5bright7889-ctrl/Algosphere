'use client'

/**
 * Workspace tab bar — create / rename (dbl-click) / duplicate / close.
 * Stays out of the way visually so it doesn't compete with the charts.
 */
import { useState } from 'react'
import { Plus, Copy, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useWorkspace } from './WorkspaceProvider'
import { MAX_TABS } from '@/lib/workspace-store'

export default function WorkspaceTabs() {
  const ws = useWorkspace()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')

  function startRename(id: string, current: string) {
    setEditingId(id); setDraft(current)
  }
  function commit() {
    if (editingId) ws.renameTab(editingId, draft)
    setEditingId(null)
  }

  return (
    <div className="flex items-center gap-1 overflow-x-auto border-b border-border/60 bg-card/40 px-2 py-1.5">
      {ws.state.tabs.map((t) => {
        const on = t.id === ws.state.activeTab
        const editing = editingId === t.id
        return (
          <div key={t.id}
               className={cn(
                 'group flex shrink-0 items-center gap-1 rounded-md border px-2 py-1 text-xs transition-colors',
                 on ? 'border-amber-500/40 bg-amber-500/10 text-amber-200'
                    : 'border-border/60 text-muted-foreground hover:text-foreground',
               )}>
            {editing ? (
              <input
                autoFocus value={draft} onChange={(e) => setDraft(e.target.value)}
                onBlur={commit}
                onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditingId(null) }}
                className="w-28 bg-transparent text-xs font-semibold outline-none"
                aria-label="Rename workspace"
              />
            ) : (
              <button type="button"
                      onClick={() => ws.setActiveTab(t.id)}
                      onDoubleClick={() => startRename(t.id, t.name)}
                      title="Double-click to rename"
                      className="font-semibold">
                {t.name}
              </button>
            )}
            {on && (
              <>
                <button type="button" onClick={() => ws.duplicateTab(t.id)}
                        title="Duplicate"
                        className="opacity-60 hover:opacity-100">
                  <Copy className="h-3 w-3" strokeWidth={1.75} aria-hidden />
                </button>
                {ws.state.tabs.length > 1 && (
                  <button type="button" onClick={() => ws.deleteTab(t.id)}
                          title="Close workspace"
                          className="opacity-60 hover:text-rose-300 hover:opacity-100">
                    <X className="h-3 w-3" strokeWidth={2} aria-hidden />
                  </button>
                )}
              </>
            )}
          </div>
        )
      })}
      <button type="button" onClick={ws.createTab}
              disabled={ws.state.tabs.length >= MAX_TABS}
              title={ws.state.tabs.length >= MAX_TABS ? `Limit ${MAX_TABS} tabs` : 'New workspace (n)'}
              className="flex shrink-0 items-center gap-1 rounded-md border border-dashed border-border/60 px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:border-amber-500/40 hover:text-amber-300 disabled:opacity-40">
        <Plus className="h-3 w-3" strokeWidth={2} aria-hidden /> New
      </button>
    </div>
  )
}
