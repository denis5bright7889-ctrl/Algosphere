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

  // Fullscreen — true browser fullscreen via the native API (TradingView
  // / Bloomberg-style: hides URL bar, browser tabs, OS chrome). Falls
  // back to CSS-only fullscreen when the native API is unavailable
  // (iframes missing allow="fullscreen", strict CSP, embedded webviews).
  //
  // CRITICAL: `requestFullscreen()` MUST be called synchronously inside
  // the click handler — any `await` or promise resolution before the
  // call loses the user-gesture context and the browser silently
  // rejects with "Permission denied / no user activation". The prior
  // version awaited it, which explains why the button did nothing.
  const shellRef = useRef<HTMLDivElement>(null)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [cssFullscreen, setCssFullscreen] = useState(false)

  const toggleFullscreen = useCallback(() => {
    const inNative = !!document.fullscreenElement
    if (inNative) {
      document.exitFullscreen().catch(() => {})
      return
    }
    if (cssFullscreen) {
      setCssFullscreen(false)
      return
    }
    const el = shellRef.current
    if (!el) return
    // Synchronous request preserves the gesture context. The promise
    // is only inspected for its rejection path — we don't await.
    const req = el.requestFullscreen?.()
    if (req && typeof req.catch === 'function') {
      req.catch((err: unknown) => {
        // Native failed (likely iframe / CSP / policy). Fall back to
        // CSS-only fullscreen so the user still gets edge-to-edge.
        console.warn('[workspace] native fullscreen rejected — falling back to CSS:', err)
        setCssFullscreen(true)
      })
    } else if (!req) {
      // No Fullscreen API at all (very old browser / iframe). CSS only.
      setCssFullscreen(true)
    }
  }, [cssFullscreen])

  useEffect(() => {
    function onChange() { setIsFullscreen(!!document.fullscreenElement) }
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  // Composite flag — true if EITHER native or CSS fullscreen is active.
  const fsActive = isFullscreen || cssFullscreen

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
      if (e.key === 'Escape') {
        // Esc unwinds in reverse-priority order: theater → CSS-fullscreen.
        // Native fullscreen Esc is handled by the browser itself.
        if (theaterPanelId)  { e.preventDefault(); setTheaterPanelId(null); return }
        if (cssFullscreen)   { e.preventDefault(); setCssFullscreen(false); return }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [ws, theaterPanelId, cssFullscreen, toggleFullscreen])

  const compact = ws.state.density === 'compact'

  function toggleTheater(id: string) {
    setTheaterPanelId((cur) => cur === id ? null : id)
  }

  // The dashboard layout already pads `main` with px-3 py-4 / md:p-6. The
  // workspace wants edge-to-edge density, so we negate that with a
  // negative margin and reset our own padding to zero.
  return (
    <div ref={shellRef} className={cn(
      'flex min-h-[640px] flex-col overflow-hidden bg-background',
      compact ? 'text-[12px]' : 'text-[13px]',
      // Normal mode: negate the dashboard's <main> padding so the
      // workspace runs edge-to-edge within the dashboard chrome.
      // Native-fullscreen mode: browser sets the element to viewport
      // size automatically — we drop the negative margins (they'd push
      // content offscreen) and use h-screen / w-screen explicitly so
      // the layout fills the screen at any DPR.
      // CSS-fullscreen mode (native API failed): position:fixed inset:0
      // z:50 so we cover the dashboard chrome ourselves. z-50 sits
      // above sidebar (z-40) + sticky header (z-30), below modals
      // (z-100).
      isFullscreen   && 'h-screen w-screen',
      cssFullscreen  && 'fixed inset-0 z-50 h-screen w-screen',
      !fsActive      && '-m-3 h-full md:-m-6',
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
                aria-label={fsActive ? 'Exit fullscreen' : 'Enter fullscreen'}
                title={fsActive ? 'Exit fullscreen (f)' : 'Fullscreen (f)'}
                className={cn('rounded-md border border-border/60 p-1.5 text-muted-foreground hover:text-foreground',
                              fsActive && 'bg-amber-500/15 text-amber-300')}>
          {fsActive
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
