'use client'

/**
 * Workspace orchestrator — composes the provider, top bar (tabs +
 * layout picker + density + sidebar/rail toggles), sidebar, chart grid,
 * and AI rail. Owns the ephemeral theater + collapse UI; persisted
 * state lives in the provider.
 *
 * Keyboard (scoped to the workspace): 1/2/3/4 layout, n new tab,
 * Esc exits theater. "/" focuses the sidebar search (registered
 * inside SymbolSidebar).
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Sidebar as SidebarIcon, PanelRight, LayoutGrid, Maximize2, Minimize2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import WorkspaceProvider, { useWorkspace } from '@/components/workspace/WorkspaceProvider'
import WorkspaceTabs   from '@/components/workspace/WorkspaceTabs'
import LayoutPicker    from '@/components/workspace/LayoutPicker'
import SymbolSidebar   from '@/components/workspace/SymbolSidebar'
import ChartGrid       from '@/components/workspace/ChartGrid'
import WorkspaceAIRail from '@/components/workspace/WorkspaceAIRail'
import SectionBoundary from '@/components/workspace/SectionBoundary'
import type { LayoutMode, Density } from '@/lib/workspace-store'

export default function WorkspaceClient() {
  return (
    <WorkspaceProvider>
      <WorkspaceShell />
    </WorkspaceProvider>
  )
}

function WorkspaceShell() {
  const ws = useWorkspace()
  const [theaterPanelId, setTheaterPanelId] = useState<string | null>(null)

  // Fullscreen state — uses the native Fullscreen API on the workspace
  // root, so the workspace fills the entire screen with no dashboard
  // chrome / browser tabs visible. 'f' toggles; Esc exits (the browser
  // handles that natively when in fullscreen). The state mirrors
  // `document.fullscreenElement` via the `fullscreenchange` event, so
  // it stays correct even if the user exits via Esc.
  const shellRef = useRef<HTMLDivElement>(null)
  const [isFullscreen, setIsFullscreen] = useState(false)

  const toggleFullscreen = useCallback(async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen()
      } else if (shellRef.current) {
        await shellRef.current.requestFullscreen()
      }
    } catch {
      // Some embedded contexts disallow fullscreen — silently no-op.
    }
  }, [])

  useEffect(() => {
    function onChange() { setIsFullscreen(!!document.fullscreenElement) }
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  // Workspace-scoped shortcuts. We only intercept when no input/textarea
  // is focused so we never eat user typing.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable) return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const map: Record<string, LayoutMode> = { '1': 'single', '2': 'split-v', '3': 'split-h', '4': 'quad' }
      if (map[e.key]) { e.preventDefault(); ws.setLayout(map[e.key]!); return }
      if (e.key === 'n') { e.preventDefault(); ws.createTab(); return }
      if (e.key === 'f') { e.preventDefault(); toggleFullscreen(); return }
      if (e.key === 'Escape' && theaterPanelId) { e.preventDefault(); setTheaterPanelId(null); return }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [ws, theaterPanelId, toggleFullscreen])

  const compact = ws.state.density === 'compact'

  function toggleTheater(id: string) {
    setTheaterPanelId((cur) => cur === id ? null : id)
  }

  // The dashboard layout already pads `main` with px-3 py-4 / md:p-6. The
  // workspace wants edge-to-edge density, so we negate that with a
  // negative margin and reset our own padding to zero.
  return (
    <div ref={shellRef} className={cn(
      // Negate the dashboard's <main> padding so the workspace runs edge-to-
      // edge; h-full inherits from the flex-bounded parent — no viewport math.
      // In native fullscreen, the negative margins don't matter (the element
      // fills the screen), but `h-screen` overrides h-full so the body
      // doesn't get clipped by the fullscreen API's default sizing.
      '-m-3 flex min-h-[640px] flex-col overflow-hidden bg-background md:-m-6',
      isFullscreen ? 'h-screen' : 'h-full',
      compact ? 'text-[12px]' : 'text-[13px]',
    )}>
      {/* Top chrome — wrapped in a boundary so a tabs crash can't kill
          the workspace (the chart grid is still usable without tabs). */}
      <SectionBoundary section="tabs"><WorkspaceTabs /></SectionBoundary>
      <div className="flex items-center gap-2 border-b border-border/60 bg-card/30 px-2 py-1.5">
        <LayoutPicker />
        <DensityToggle density={ws.state.density} onChange={ws.setDensity} />
        <button type="button" onClick={ws.toggleSidebar}
                aria-label="Toggle symbol sidebar"
                title="Toggle sidebar"
                className={cn('rounded-md border border-border/60 p-1.5 text-muted-foreground hover:text-foreground',
                              ws.state.sidebarOpen && 'bg-accent/40 text-foreground')}>
          <SidebarIcon className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
        </button>
        <button type="button" onClick={ws.toggleRail}
                aria-label="Toggle AI rail"
                title="Toggle AI rail"
                className={cn('rounded-md border border-border/60 p-1.5 text-muted-foreground hover:text-foreground',
                              ws.state.railOpen && 'bg-accent/40 text-foreground')}>
          <PanelRight className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
        </button>
        <button type="button" onClick={toggleFullscreen}
                aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
                title={isFullscreen ? 'Exit fullscreen (f)' : 'Fullscreen edge-to-edge (f)'}
                className={cn('rounded-md border border-border/60 p-1.5 text-muted-foreground hover:text-foreground',
                              isFullscreen && 'bg-amber-500/15 text-amber-300')}>
          {isFullscreen
            ? <Minimize2 className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
            : <Maximize2 className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />}
        </button>
        <span className="ml-auto flex items-center gap-1 text-[10px] text-muted-foreground">
          <LayoutGrid className="h-3 w-3" strokeWidth={1.75} aria-hidden />
          {ws.activeTab.panels.length} panel{ws.activeTab.panels.length === 1 ? '' : 's'} · keys 1/2/3/4 · n new · f fullscreen · Esc exit
        </span>
      </div>

      {/* Body: sidebar | grid | rail.
          Each section is wrapped in its own boundary so a crash in one
          (e.g. a leaf component in the AI rail consuming a malformed
          API response) cannot take down the entire route. The user
          still gets the chart even if the AI rail dies. */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {ws.state.sidebarOpen && (
          <div className="hidden w-56 shrink-0 md:block">
            <SectionBoundary section="sidebar"><SymbolSidebar /></SectionBoundary>
          </div>
        )}
        <main className="min-w-0 flex-1 overflow-hidden">
          <SectionBoundary section="chart-grid">
            <ChartGrid theaterPanelId={theaterPanelId} onToggleTheater={toggleTheater} />
          </SectionBoundary>
        </main>
        {ws.state.railOpen && (
          <div className="hidden w-80 shrink-0 lg:block xl:w-96">
            <SectionBoundary section="ai-rail"><WorkspaceAIRail /></SectionBoundary>
          </div>
        )}
      </div>
    </div>
  )
}

function DensityToggle({ density, onChange }: { density: Density; onChange: (d: Density) => void }) {
  return (
    <div className="flex items-center gap-0.5 rounded-lg border border-border/60 bg-background/40 p-0.5">
      {(['comfortable', 'compact'] as Density[]).map((d) => (
        <button key={d} type="button" onClick={() => onChange(d)}
                {...{ 'aria-pressed': density === d }}
                className={cn(
                  'rounded-md px-2 py-1 text-[10px] font-semibold uppercase tracking-wider transition-colors',
                  density === d ? 'bg-gradient-primary text-black' : 'text-muted-foreground hover:text-foreground',
                )}>
          {d === 'comfortable' ? 'Comfy' : 'Compact'}
        </button>
      ))}
    </div>
  )
}
