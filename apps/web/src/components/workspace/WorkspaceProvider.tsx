'use client'

/**
 * Workspace context — holds the persistent chart-workspace state and
 * exposes the operations the workspace UI needs. State lives in
 * localStorage (see workspace-store), so reload restores the user's
 * tabs / panels / favorites without server round-trips.
 *
 * Single source of truth for the /workspace route; the legacy chart
 * modal (PR #41) is untouched and remains the "quick look" path.
 */
import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from 'react'
import {
  defaultState, loadState, saveState, fitPanelsToLayout, dedupePush, toggleMembership,
  makePanel, makeTab,
  MAX_COMPARE, MAX_FAVORITES, MAX_RECENTS, MAX_TABS,
  type WorkspaceState, type WorkspaceTab, type ChartPanelState,
  type LayoutMode, type Density,
} from '@/lib/workspace-store'
import type { AssetClass } from '@/lib/market-universe'

interface Api {
  state: WorkspaceState
  activeTab:    WorkspaceTab
  activePanel:  ChartPanelState

  // Tabs
  setActiveTab:   (id: string) => void
  createTab:      () => void
  renameTab:      (id: string, name: string) => void
  duplicateTab:   (id: string) => void
  deleteTab:      (id: string) => void

  // Layout
  setLayout:      (m: LayoutMode) => void

  // Panels
  setActivePanel: (id: string) => void
  setPanelSymbol: (panelId: string, symbol: string, assetClass?: AssetClass) => void
  setPanelInterval: (panelId: string, interval: string) => void
  addPanelCompare:    (panelId: string, symbol: string) => void
  removePanelCompare: (panelId: string, symbol: string) => void
  clearPanelCompare:  (panelId: string) => void

  // Symbol meta
  toggleFavorite: (symbol: string) => void
  isFavorite:     (symbol: string) => boolean
  pushRecent:     (symbol: string) => void

  // Chrome
  setDensity:     (d: Density) => void
  toggleSidebar:  () => void
  toggleRail:     () => void
}

const Ctx = createContext<Api | null>(null)

export function useWorkspace(): Api {
  const c = useContext(Ctx)
  if (!c) throw new Error('useWorkspace must be used within <WorkspaceProvider>')
  return c
}

export default function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  // SSR-safe initial; real state hydrates after mount.
  const [state, setState] = useState<WorkspaceState>(defaultState)
  const hydrated = useRef(false)

  useEffect(() => {
    setState(loadState())
    hydrated.current = true
  }, [])

  useEffect(() => {
    if (hydrated.current) saveState(state)
  }, [state])

  // ── Derived ────────────────────────────────────────────────────────────
  // Both `state.tabs` and `activeTab.panels` are guaranteed non-empty by
  // loadState's sanitizer + the action-creators (deleteTab keeps ≥1 tab,
  // fitPanelsToLayout returns ≥1 panel). The fallbacks below are a
  // belt-and-braces guard so a hypothetical state corruption (e.g. a
  // dev clearing tabs in devtools) can never render `undefined` and
  // crash the whole route into the error boundary.
  const activeTab = useMemo<WorkspaceTab>(
    () =>
      state.tabs.find((t) => t.id === state.activeTab)
      ?? state.tabs[0]
      ?? makeTab(),
    [state.tabs, state.activeTab],
  )
  const activePanel = useMemo<ChartPanelState>(
    () =>
      activeTab.panels.find((p) => p.id === activeTab.activePanelId)
      ?? activeTab.panels[0]
      ?? makePanel('BTCUSDT', 'crypto'),
    [activeTab],
  )

  // ── Tab ops ────────────────────────────────────────────────────────────
  const setActiveTab = useCallback((id: string) => setState((s) =>
    s.tabs.some((t) => t.id === id) ? { ...s, activeTab: id } : s,
  ), [])
  const createTab = useCallback(() => setState((s) => {
    if (s.tabs.length >= MAX_TABS) return s
    const t = makeTab(`Workspace ${s.tabs.length + 1}`)
    return { ...s, tabs: [...s.tabs, t], activeTab: t.id }
  }), [])
  const renameTab = useCallback((id: string, name: string) => setState((s) => ({
    ...s, tabs: s.tabs.map((t) => t.id === id ? { ...t, name: name.trim() || t.name } : t),
  })), [])
  const duplicateTab = useCallback((id: string) => setState((s) => {
    if (s.tabs.length >= MAX_TABS) return s
    const src = s.tabs.find((t) => t.id === id)
    if (!src) return s
    // Re-id everything so panel ids stay unique across the workspace.
    const panels = src.panels.map((p) => ({ ...makePanel(p.symbol, p.assetClass), interval: p.interval, compareWith: [...p.compareWith] }))
    const clone: WorkspaceTab = {
      id: `t_${Math.random().toString(36).slice(2, 8)}`,
      name: `${src.name} (copy)`,
      layout: src.layout,
      panels,
      activePanelId: panels[0]!.id,
    }
    return { ...s, tabs: [...s.tabs, clone], activeTab: clone.id }
  }), [])
  const deleteTab = useCallback((id: string) => setState((s) => {
    if (s.tabs.length <= 1) return s  // always keep at least one tab
    const tabs = s.tabs.filter((t) => t.id !== id)
    const activeTab = s.activeTab === id ? tabs[0]!.id : s.activeTab
    return { ...s, tabs, activeTab }
  }), [])

  // ── Layout / panels ────────────────────────────────────────────────────
  const updateActiveTab = useCallback((fn: (t: WorkspaceTab) => WorkspaceTab) => {
    setState((s) => ({ ...s, tabs: s.tabs.map((t) => t.id === s.activeTab ? fn(t) : t) }))
  }, [])
  const setLayout = useCallback((m: LayoutMode) => updateActiveTab((t) => {
    const panels = fitPanelsToLayout(t.panels, m)
    const activePanelId = panels.some((p) => p.id === t.activePanelId) ? t.activePanelId : panels[0]!.id
    return { ...t, layout: m, panels, activePanelId }
  }), [updateActiveTab])

  const setActivePanel = useCallback((id: string) => updateActiveTab((t) =>
    t.panels.some((p) => p.id === id) ? { ...t, activePanelId: id } : t,
  ), [updateActiveTab])

  const patchPanel = useCallback((panelId: string, patch: Partial<ChartPanelState>) => updateActiveTab((t) => ({
    ...t, panels: t.panels.map((p) => p.id === panelId ? { ...p, ...patch } : p),
  })), [updateActiveTab])

  const setPanelSymbol = useCallback((panelId: string, symbol: string, assetClass?: AssetClass) =>
    patchPanel(panelId, { symbol, assetClass, compareWith: [] }), [patchPanel])
  const setPanelInterval = useCallback((panelId: string, interval: string) =>
    patchPanel(panelId, { interval }), [patchPanel])

  const addPanelCompare = useCallback((panelId: string, symbol: string) => updateActiveTab((t) => ({
    ...t, panels: t.panels.map((p) => p.id === panelId
      ? { ...p, compareWith: p.symbol === symbol || p.compareWith.includes(symbol)
          ? p.compareWith
          : [...p.compareWith, symbol].slice(0, MAX_COMPARE) }
      : p),
  })), [updateActiveTab])
  const removePanelCompare = useCallback((panelId: string, symbol: string) => updateActiveTab((t) => ({
    ...t, panels: t.panels.map((p) => p.id === panelId
      ? { ...p, compareWith: p.compareWith.filter((s) => s !== symbol) }
      : p),
  })), [updateActiveTab])
  const clearPanelCompare = useCallback((panelId: string) =>
    patchPanel(panelId, { compareWith: [] }), [patchPanel])

  // ── Symbol meta ────────────────────────────────────────────────────────
  const toggleFavorite = useCallback((symbol: string) => setState((s) => ({
    ...s, favorites: toggleMembership(s.favorites, symbol, MAX_FAVORITES),
  })), [])
  const isFavorite = useCallback((symbol: string) => state.favorites.includes(symbol), [state.favorites])
  const pushRecent = useCallback((symbol: string) => setState((s) => ({
    ...s, recents: dedupePush(s.recents, symbol, MAX_RECENTS),
  })), [])

  // ── Chrome ─────────────────────────────────────────────────────────────
  const setDensity     = useCallback((d: Density) => setState((s) => ({ ...s, density: d })), [])
  const toggleSidebar  = useCallback(() => setState((s) => ({ ...s, sidebarOpen: !s.sidebarOpen })), [])
  const toggleRail     = useCallback(() => setState((s) => ({ ...s, railOpen: !s.railOpen })), [])

  const api: Api = {
    state, activeTab, activePanel,
    setActiveTab, createTab, renameTab, duplicateTab, deleteTab,
    setLayout,
    setActivePanel, setPanelSymbol, setPanelInterval,
    addPanelCompare, removePanelCompare, clearPanelCompare,
    toggleFavorite, isFavorite, pushRecent,
    setDensity, toggleSidebar, toggleRail,
  }

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>
}
