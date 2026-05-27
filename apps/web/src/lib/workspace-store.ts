/**
 * Workspace store — typed state + localStorage persistence for the
 * institutional chart workspace at /workspace.
 *
 * The workspace is a collection of named tabs. Each tab carries a
 * layout (grid preset) and 1–4 chart panels; each panel is a symbol +
 * timeframe + optional compare overlays. State persists per browser
 * via localStorage; the schema is versioned so future migrations don't
 * thrash existing users. Supabase sync is out of scope for this slice —
 * see the workspace PR for the deferral rationale.
 */
import { DEFAULT_INTERVAL } from './tradingview'
import type { AssetClass } from './market-universe'

export const STORAGE_KEY     = 'algosphere.workspace.v1'
export const SCHEMA_VERSION  = 1
export const MAX_TABS        = 8
export const MAX_FAVORITES   = 40
export const MAX_RECENTS     = 12
export const MAX_COMPARE     = 3

export type LayoutMode = 'single' | 'split-h' | 'split-v' | 'quad'
export type Density    = 'comfortable' | 'compact'

export const LAYOUT_PANELS: Record<LayoutMode, number> = {
  single: 1, 'split-h': 2, 'split-v': 2, quad: 4,
}

export interface ChartPanelState {
  /** Stable id within the workspace tab — kept across symbol switches so
   *  React can reuse the iframe instead of re-mounting on every change. */
  id:           string
  symbol:       string
  assetClass?:  AssetClass
  interval:     string
  /** Internal symbols (e.g. BTCUSDT, ETHUSDT). Mapped to TV symbols by
   *  toTradingViewSymbol at render time so a registry update propagates. */
  compareWith:  string[]
}

export interface WorkspaceTab {
  id:        string
  name:      string
  layout:    LayoutMode
  panels:    ChartPanelState[]
  activePanelId: string   // which panel the AI rail follows
}

export interface WorkspaceState {
  version:    number
  tabs:       WorkspaceTab[]
  activeTab:  string
  favorites:  string[]    // symbol codes
  recents:    string[]    // symbol codes, newest first
  density:    Density
  sidebarOpen: boolean
  railOpen:   boolean
}

// ── Defaults ────────────────────────────────────────────────────────────

function makePanel(symbol: string, assetClass?: AssetClass): ChartPanelState {
  return {
    id:          `p_${Math.random().toString(36).slice(2, 8)}`,
    symbol,
    assetClass,
    interval:    DEFAULT_INTERVAL,
    compareWith: [],
  }
}

function makeTab(name = 'Workspace 1', symbol = 'BTCUSDT', assetClass: AssetClass = 'crypto'): WorkspaceTab {
  const panel = makePanel(symbol, assetClass)
  return {
    id:            `t_${Math.random().toString(36).slice(2, 8)}`,
    name,
    layout:        'single',
    panels:        [panel],
    activePanelId: panel.id,
  }
}

export function defaultState(): WorkspaceState {
  const t = makeTab()
  return {
    version:     SCHEMA_VERSION,
    tabs:        [t],
    activeTab:   t.id,
    favorites:   ['BTCUSDT', 'ETHUSDT', 'XAUUSD', 'EURUSD'],
    recents:     [],
    density:     'comfortable',
    sidebarOpen: true,
    railOpen:    true,
  }
}

// ── Persistence ─────────────────────────────────────────────────────────

export function loadState(): WorkspaceState {
  if (typeof window === 'undefined') return defaultState()
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return defaultState()
    const parsed = JSON.parse(raw) as Partial<WorkspaceState>
    if (parsed.version !== SCHEMA_VERSION) return defaultState()
    // Light shape check — bail to defaults if anything's off rather than crash.
    if (!Array.isArray(parsed.tabs) || parsed.tabs.length === 0) return defaultState()
    return { ...defaultState(), ...parsed } as WorkspaceState
  } catch {
    return defaultState()
  }
}

export function saveState(s: WorkspaceState): void {
  if (typeof window === 'undefined') return
  try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(s)) } catch { /* quota / disabled — silently no-op */ }
}

// ── Pure reducers (used by the provider for state updates) ──────────────

export function fitPanelsToLayout(panels: ChartPanelState[], layout: LayoutMode): ChartPanelState[] {
  const need = LAYOUT_PANELS[layout]
  if (panels.length === need) return panels
  if (panels.length > need)   return panels.slice(0, need)
  const seed = panels[panels.length - 1] ?? makePanel('BTCUSDT', 'crypto')
  const extras: ChartPanelState[] = []
  for (let i = panels.length; i < need; i++) extras.push(makePanel(seed.symbol, seed.assetClass))
  return [...panels, ...extras]
}

export function dedupePush<T>(arr: T[], v: T, max: number): T[] {
  const filtered = arr.filter((x) => x !== v)
  return [v, ...filtered].slice(0, max)
}

export function toggleMembership<T>(arr: T[], v: T, max: number): T[] {
  return arr.includes(v) ? arr.filter((x) => x !== v) : [v, ...arr].slice(0, max)
}

export { makePanel, makeTab }
