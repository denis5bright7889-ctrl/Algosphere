'use client'

/**
 * Layout grid for the workspace. CSS-grid presets (single / split-V /
 * split-H / quad) — click-to-switch, no drag-resize this slice (see PR
 * for rationale). Theater mode (one panel expanded) is honoured by
 * rendering only the theatred panel.
 */
import { cn } from '@/lib/utils'
import { useWorkspace } from './WorkspaceProvider'
import ChartPanel from './ChartPanel'
import type { LayoutMode } from '@/lib/workspace-store'

const GRID_CLASS: Record<LayoutMode, string> = {
  single:    'grid-cols-1 grid-rows-1',
  'split-v': 'grid-cols-2 grid-rows-1',
  'split-h': 'grid-cols-1 grid-rows-2',
  quad:      'grid-cols-2 grid-rows-2',
}

export default function ChartGrid({
  theaterPanelId, onToggleTheater,
}: {
  theaterPanelId: string | null
  onToggleTheater: (id: string) => void
}) {
  const ws = useWorkspace()
  const { panels, layout } = ws.activeTab

  const theatered = theaterPanelId
    ? panels.find((p) => p.id === theaterPanelId) ?? null
    : null

  if (theatered) {
    return (
      <div className="h-full min-h-0 p-2">
        <ChartPanel panel={theatered} theaterPanelId={theaterPanelId} onToggleTheater={onToggleTheater} />
      </div>
    )
  }

  return (
    <div className={cn('grid h-full min-h-0 gap-2 p-2', GRID_CLASS[layout])}>
      {panels.map((p) => (
        <ChartPanel key={p.id} panel={p} theaterPanelId={theaterPanelId} onToggleTheater={onToggleTheater} />
      ))}
    </div>
  )
}
