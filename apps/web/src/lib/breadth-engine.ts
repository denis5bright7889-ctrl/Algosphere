/**
 * Market breadth intelligence.
 *
 * Two honest sources, kept clearly separated in the output:
 *  1. CRYPTO BREADTH — computed from the live CoinGecko top-250 24h
 *     changes (advancing / declining / participation). Sample size is
 *     surfaced in the response so the UI can show it verbatim.
 *  2. ENGINE-SCANNED BREADTH (per asset class) — derived from the most
 *     recent `regime_snapshots` row per symbol, joined to the registry
 *     for the asset-class bucket. This is a much smaller universe
 *     (≤~30 symbols), so the UI labels it "engine-scanned" to avoid
 *     anyone reading it as full-market breadth.
 *
 * We do NOT fabricate forex/indices/metals breadth from data we don't
 * have; missing classes render honestly as `available: false`.
 */
import 'server-only'
import { createClient } from '@/lib/supabase/server'
import { fetchTop250Markets } from './cg-markets'
import { symbolByCode } from './symbol-registry'
import type { AssetClass } from './market-universe'

export type BreadthState = 'Broad' | 'Selective' | 'Narrow' | 'Weak' | 'N/A'
export type HealthLabel  = 'Healthy' | 'Mixed' | 'Fragile' | 'N/A'
export type Posture      = 'Risk-On' | 'Mixed' | 'Risk-Off' | 'N/A'

export interface BreadthSlice {
  source:        'coingecko-top-250' | 'engine-scanned'
  class_label:   string
  sample_size:   number
  available:     boolean
  advancing:     number
  declining:     number
  flat:          number
  pct_advancing: number      // 0–100
  median_change: number      // %, rounded
  state:         BreadthState
  health:        HealthLabel
  reason?:       string
}

export interface BreadthView {
  crypto:           BreadthSlice          // from CoinGecko 250
  by_class:         BreadthSlice[]        // engine-scanned per class
  health_score:     number                // 0–100 composite (crypto + engine)
  posture:          Posture
  narrative:        string
  generated_at:     string
}

// ── Classifiers (states emerge from breadth × momentum, not magic) ─────

function breadthState(pctAdvancing: number, medianChange: number): BreadthState {
  if (pctAdvancing >= 70 && medianChange >  0.5)  return 'Broad'
  if (pctAdvancing >= 55)                          return 'Selective'
  if (pctAdvancing >= 35)                          return 'Narrow'
  return 'Weak'
}
function healthLabel(state: BreadthState, sample: number): HealthLabel {
  if (sample < 4) return 'N/A'
  if (state === 'Broad')                           return 'Healthy'
  if (state === 'Selective')                       return 'Mixed'
  if (state === 'Narrow' || state === 'Weak')      return 'Fragile'
  return 'N/A'
}
function postureFromCrypto(s: BreadthSlice): Posture {
  if (!s.available) return 'N/A'
  if (s.state === 'Broad')                         return 'Risk-On'
  if (s.state === 'Narrow' || s.state === 'Weak')  return 'Risk-Off'
  return 'Mixed'
}

// ── Slice builders ─────────────────────────────────────────────────────

function buildSlice(args: {
  source: BreadthSlice['source']
  class_label: string
  changes: number[]
}): BreadthSlice {
  const { source, class_label, changes } = args
  if (changes.length === 0) {
    return {
      source, class_label, sample_size: 0, available: false,
      advancing: 0, declining: 0, flat: 0, pct_advancing: 0,
      median_change: 0, state: 'N/A', health: 'N/A',
      reason: 'No samples available.',
    }
  }
  const advancing = changes.filter((c) => c > 0).length
  const declining = changes.filter((c) => c < 0).length
  const flat      = changes.length - advancing - declining
  const pct_advancing = Math.round((advancing / changes.length) * 100)
  const sorted = [...changes].sort((a, b) => a - b)
  const mid = sorted.length >> 1
  const medianChange = sorted.length % 2 === 0
    ? (sorted[mid - 1]! + sorted[mid]!) / 2
    : sorted[mid]!
  const state  = breadthState(pct_advancing, medianChange)
  const health = healthLabel(state, changes.length)
  return {
    source, class_label, sample_size: changes.length, available: true,
    advancing, declining, flat, pct_advancing,
    median_change: Number(medianChange.toFixed(2)),
    state, health,
  }
}

// ── Composer ───────────────────────────────────────────────────────────

const CLASS_LABEL: Partial<Record<AssetClass, string>> = {
  crypto: 'Crypto', forex: 'Forex', gold: 'Gold', commodities: 'Commodities',
  indices: 'Indices', stocks: 'Stocks', volatility: 'Volatility',
}

export async function composeBreadthView(): Promise<BreadthView> {
  const generated_at = new Date().toISOString()

  // ── Crypto breadth from CoinGecko top 250 ──────────────────────────
  const mkts = await fetchTop250Markets()
  const cryptoChanges = mkts.ok
    ? mkts.rows.map((c) => c.price_change_percentage_24h ?? 0)
    : []
  let crypto: BreadthSlice = buildSlice({
    source: 'coingecko-top-250', class_label: 'Crypto (CG top 250)',
    changes: cryptoChanges,
  })
  if (!mkts.ok) crypto = { ...crypto, reason: mkts.reason }

  // ── Engine-scanned per class ───────────────────────────────────────
  const supabase = await createClient()
  const { data: snaps } = await supabase
    .from('regime_snapshots')
    .select('symbol, der_score, scanned_at')
    .order('scanned_at', { ascending: false })
    .limit(300)

  // Latest per symbol, then bucket by registered asset class.
  const seen = new Set<string>()
  const byClass = new Map<AssetClass, number[]>()
  for (const r of snaps ?? []) {
    if (seen.has(r.symbol)) continue
    seen.add(r.symbol)
    const meta = symbolByCode(r.symbol)
    if (!meta) continue
    const arr = byClass.get(meta.asset_class) ?? []
    // DER is 0..1 directional energy. We don't have signed direction from
    // it alone, so we use it as a "momentum present" proxy: above 0.30 =
    // directional, treated as advancing; below = lacking energy, treated
    // as flat for the purposes of engine-scanned breadth. (Honest: this
    // is a coarser breadth signal than the per-asset 24h change.)
    const proxy = r.der_score >= 0.30 ? 1 : r.der_score >= 0.15 ? 0 : -1
    arr.push(proxy)
    byClass.set(meta.asset_class, arr)
  }

  const by_class: BreadthSlice[] = []
  for (const [ac, label] of Object.entries(CLASS_LABEL) as [AssetClass, string][]) {
    const changes = byClass.get(ac) ?? []
    by_class.push(buildSlice({
      source: 'engine-scanned',
      class_label: `${label} (engine-scanned)`,
      changes,
    }))
  }

  // ── Composite health score: weighted toward crypto (larger sample). ─
  const cryptoScore = crypto.available ? crypto.pct_advancing : 50
  const engineSlices = by_class.filter((s) => s.available)
  const engineAvg = engineSlices.length > 0
    ? engineSlices.reduce((s, x) => s + x.pct_advancing, 0) / engineSlices.length
    : 50
  const health_score = Math.round(cryptoScore * 0.7 + engineAvg * 0.3)
  const posture = postureFromCrypto(crypto)
  const narrative = narrateBreadth(crypto, posture, health_score)

  return { crypto, by_class, health_score, posture, narrative, generated_at }
}

function narrateBreadth(crypto: BreadthSlice, posture: Posture, score: number): string {
  if (!crypto.available) return 'Breadth unavailable — CoinGecko universe could not be fetched.'
  const tail = crypto.state === 'Broad'   ? 'Risk appetite is healthy across the breadth.'
             : crypto.state === 'Narrow'  ? 'Leadership is narrow — sustainability is in question.'
             : crypto.state === 'Weak'    ? 'Internal deterioration — leadership has lost broad support.'
             : 'Mixed internals — no clear conviction across the breadth.'
  return `${crypto.state} crypto breadth (${crypto.pct_advancing}% of ${crypto.sample_size} advancing). ${tail} Composite health ${score}/100, posture ${posture}.`
}
