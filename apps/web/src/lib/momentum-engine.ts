/**
 * Momentum Engine — institutional phase detection.
 *
 * Answers the brief's required questions: is momentum healthy, sustainable,
 * overcrowded, weakening, or accelerating? Maps to the 7 institutional
 * phases (Accumulation → Distribution → Collapse Risk).
 *
 * Sourcing: composes from the regime-snapshot TRAJECTORY (recent vs prior
 * window of DER / autocorrelation / ATR) plus optional Nansen momentum
 * data. No new engine code is required — the signal-engine continues to
 * write snapshots; this module reads the trajectory and classifies.
 *
 * Honesty rules (per the brief):
 *   - never exposes DER / autocorr / ATR numbers in the OUTPUT
 *   - reports `phase='Unknown'` with reason if too little history
 *   - sustainability/quality computed only from data we actually have
 */
import 'server-only'
import { createClient } from '@/lib/supabase/server'

export type MomentumPhase =
  | 'Accumulation'
  | 'Expansion'
  | 'Trending'
  | 'Parabolic'
  | 'Exhaustion'
  | 'Distribution'
  | 'Collapse Risk'
  | 'Unknown'

export type MomentumQuality      = 'High' | 'Moderate' | 'Low' | 'N/A'
export type MomentumSustainability = 'Sustainable' | 'Fading' | 'Decaying' | 'Building' | 'N/A'
export type MomentumDirection    = 'Up' | 'Down' | 'Sideways' | 'N/A'

export interface MomentumView {
  symbol:           string
  phase:            MomentumPhase
  direction:        MomentumDirection
  quality:          MomentumQuality
  sustainability:   MomentumSustainability
  /** 0..100 composite score — higher = healthier, more constructive momentum. */
  score:            number
  /** True when the engine has detected late-cycle behavior (overcrowded, exhaustion). */
  overcrowded:      boolean
  /** True when momentum is accelerating (rising velocity). */
  accelerating:     boolean
  /** True when momentum is weakening (falling velocity in a prior trend). */
  weakening:        boolean
  /** Short institutional narrative — never a formula. */
  signal:           string
  generated_at:     string
  /** True when the snapshot window was too thin to classify confidently. */
  partial:          boolean
}

interface RegimeRow {
  regime:           string
  der_score:        number
  autocorr_score:   number
  atr_pct:          number
  scanned_at:       string
}

/** Reads the most-recent N snapshots for one symbol (newest first). */
async function loadTrajectory(symbol: string, n = 12): Promise<RegimeRow[]> {
  const sb = await createClient()
  const { data } = await sb
    .from('regime_snapshots')
    .select('regime, der_score, autocorr_score, atr_pct, scanned_at')
    .eq('symbol', symbol)
    .order('scanned_at', { ascending: false })
    .limit(n)
  return (data ?? []) as unknown as RegimeRow[]
}

// ── Trajectory helpers ───────────────────────────────────────────────────

function avg(arr: number[]): number {
  if (arr.length === 0) return 0
  return arr.reduce((a, b) => a + b, 0) / arr.length
}

interface Trajectory {
  current:  { der: number; ac: number; atr: number }
  prior:    { der: number; ac: number; atr: number }
  delta:    { der: number; ac: number; atr: number }
  bars:     number    // how many snapshots informed the read
}

function buildTrajectory(rows: RegimeRow[]): Trajectory | null {
  if (rows.length < 3) return null
  // Split into recent half vs older half so trajectory == short-window average delta.
  const split = Math.floor(rows.length / 2)
  const recent = rows.slice(0, split)
  const older  = rows.slice(split)
  const cur = {
    der: avg(recent.map((r) => Number(r.der_score) || 0)),
    ac:  avg(recent.map((r) => Number(r.autocorr_score) || 0)),
    atr: avg(recent.map((r) => Number(r.atr_pct) || 0)),
  }
  const pri = {
    der: avg(older.map((r) => Number(r.der_score) || 0)),
    ac:  avg(older.map((r) => Number(r.autocorr_score) || 0)),
    atr: avg(older.map((r) => Number(r.atr_pct) || 0)),
  }
  return {
    current: cur,
    prior:   pri,
    delta:   { der: cur.der - pri.der, ac: cur.ac - pri.ac, atr: cur.atr - pri.atr },
    bars:    rows.length,
  }
}

// ── Phase classification (institutional, transparent rules) ──────────────
//
// We deliberately keep the logic readable so it can evolve. The OUTPUT
// hides the rules — the phase label is institutional, the narrative is
// human, raw DER/ATR/autocorr are never surfaced.

function classifyPhase(t: Trajectory): { phase: MomentumPhase; direction: MomentumDirection; overcrowded: boolean; accelerating: boolean; weakening: boolean } {
  const { current: c, prior: p, delta: d } = t

  // Directional axis: persistent autocorr sign + sufficient energy
  const energyHigh   = c.der >= 0.5
  const energyVeryHigh = c.der >= 0.75
  const energyLow    = c.der <  0.35
  const ascending    = c.ac >=  0.05
  const descending   = c.ac <= -0.05
  const direction: MomentumDirection =
    !energyHigh ? 'Sideways' :
    ascending  ? 'Up' :
    descending ? 'Down' : 'Sideways'

  const atrSpike     = d.atr > c.atr * 0.25                  // ATR rising fast
  const atrCalming   = d.atr < -c.atr * 0.15                 // ATR falling

  const accelerating = d.der > 0.05 && ascending
  const weakening    = d.der < -0.05 && energyHigh
  // "Overcrowded" = parabolic + persistence loss = late-cycle warning
  const overcrowded  = energyVeryHigh && (d.ac < -0.02 || atrSpike)

  // Phase decisions, top-down by severity:
  let phase: MomentumPhase = 'Unknown'
  if (energyVeryHigh && atrSpike && Math.abs(c.ac) >= 0.1) {
    phase = 'Parabolic'
  } else if (energyHigh && d.der < -0.1 && atrSpike) {
    phase = 'Collapse Risk'
  } else if (energyHigh && (d.ac < -0.05) && energyVeryHigh) {
    phase = 'Exhaustion'
  } else if (energyHigh && atrSpike && d.der > 0) {
    phase = 'Expansion'
  } else if (energyHigh && Math.abs(c.ac) >= 0.05 && !atrSpike) {
    phase = 'Trending'
  } else if (energyLow && atrCalming && c.ac >= 0) {
    phase = 'Accumulation'
  } else if (energyLow && Math.abs(c.ac) < 0.05) {
    phase = 'Distribution'
  } else if (energyHigh && Math.abs(c.ac) < 0.05) {
    // High energy but no persistence — choppy expansion or transition
    phase = 'Expansion'
  } else {
    phase = 'Distribution'
  }

  return { phase, direction, overcrowded, accelerating, weakening }
}

function deriveQuality(phase: MomentumPhase, t: Trajectory): MomentumQuality {
  if (phase === 'Trending')     return 'High'
  if (phase === 'Expansion')    return 'Moderate'
  if (phase === 'Parabolic')    return 'Low'    // unsustainable
  if (phase === 'Exhaustion')   return 'Low'
  if (phase === 'Collapse Risk')return 'Low'
  if (phase === 'Accumulation') return 'N/A'    // no move yet to grade
  if (phase === 'Distribution') return 'N/A'
  return 'N/A'
}

function deriveSustainability(phase: MomentumPhase, t: Trajectory): MomentumSustainability {
  const ascending = t.current.ac >= 0.05
  const losing    = t.delta.ac   < -0.02
  if (phase === 'Trending'  && ascending && !losing) return 'Sustainable'
  if (phase === 'Expansion' && t.delta.der > 0)      return 'Building'
  if (phase === 'Parabolic')   return 'Decaying'
  if (phase === 'Exhaustion')  return 'Fading'
  if (phase === 'Collapse Risk') return 'Decaying'
  if (phase === 'Accumulation' || phase === 'Distribution') return 'N/A'
  return 'N/A'
}

function deriveScore(phase: MomentumPhase, t: Trajectory): number {
  // Compact 0-100 health score. High = healthy, sustainable. Low = late-cycle / decaying.
  const base: Record<MomentumPhase, number> = {
    Trending:      82,
    Expansion:     72,
    Accumulation:  55,
    Distribution:  40,
    Parabolic:     30,
    Exhaustion:    22,
    'Collapse Risk': 10,
    Unknown:        0,
  }
  const adj = (t.delta.der > 0 ? +5 : t.delta.der < -0.05 ? -10 : 0)
              + (t.delta.ac  > 0 ? +3 : t.delta.ac  < -0.03 ? -6 : 0)
  return Math.max(0, Math.min(100, (base[phase] ?? 0) + adj))
}

function narrate(phase: MomentumPhase, direction: MomentumDirection, q: MomentumQuality, s: MomentumSustainability, overcrowded: boolean): string {
  if (phase === 'Unknown') return 'Insufficient history to read momentum phase'
  const dir =
    direction === 'Up'       ? 'upward' :
    direction === 'Down'     ? 'downward' :
    direction === 'Sideways' ? 'sideways' : ''
  const intro: Record<Exclude<MomentumPhase, 'Unknown'>, string> = {
    Accumulation:   'Quiet accumulation phase — energy building beneath the surface.',
    Expansion:      `Expansion ${dir} — volatility opening as participants commit.`,
    Trending:       `Healthy ${dir} trend — persistence and energy both constructive.`,
    Parabolic:      `Parabolic ${dir} extension — high energy, late-cycle risk.`,
    Exhaustion:     `Exhaustion ${dir} — persistence fading despite remaining energy.`,
    Distribution:   'Distribution — energy bleeding off, choppy range conditions.',
    'Collapse Risk':`Collapse risk — energy and persistence both deteriorating sharply.`,
  }
  const susp = s === 'Sustainable' ? ' Sustainability is intact.'
            : s === 'Fading'       ? ' Sustainability is fading.'
            : s === 'Decaying'     ? ' Sustainability is decaying.'
            : s === 'Building'     ? ' Sustainability building.'
            : ''
  const crowd = overcrowded ? ' Positioning appears overcrowded.' : ''
  return `${intro[phase as Exclude<MomentumPhase,'Unknown'>]}${susp}${crowd}`
}

// ── Public API ───────────────────────────────────────────────────────────

export async function composeMomentumView(symbol: string): Promise<MomentumView> {
  const rows = await loadTrajectory(symbol, 12)
  const traj = buildTrajectory(rows)
  if (!traj) {
    return {
      symbol,
      phase:          'Unknown',
      direction:      'N/A',
      quality:        'N/A',
      sustainability: 'N/A',
      score:          0,
      overcrowded:    false,
      accelerating:   false,
      weakening:      false,
      signal:         rows.length === 0 ? 'No recent regime scans for this symbol' : 'Too few scans to read trajectory',
      generated_at:   new Date().toISOString(),
      partial:        true,
    }
  }
  const { phase, direction, overcrowded, accelerating, weakening } = classifyPhase(traj)
  const quality        = deriveQuality(phase, traj)
  const sustainability = deriveSustainability(phase, traj)
  const score          = deriveScore(phase, traj)
  return {
    symbol,
    phase,
    direction,
    quality,
    sustainability,
    score,
    overcrowded,
    accelerating,
    weakening,
    signal:       narrate(phase, direction, quality, sustainability, overcrowded),
    generated_at: new Date().toISOString(),
    partial:      traj.bars < 8,
  }
}
