/**
 * Symbol intelligence composer for the chart modal's AI panel.
 *
 * Reads the LATEST real `regime_snapshots` row + the latest `signals`
 * row for an instrument and translates them into the institutional
 * read the modal renders (state, confidence, trend strength, volatility,
 * momentum, structure, plus tier-gated signal levels). Pure translation
 * over real rows — never fabricated; absent data surfaces as
 * `available: false` with a reason.
 *
 * Server-only. The signal "edge" (entry/SL/TP/RR/confidence) is gated by
 * the viewer's tier with the same `canAccess` predicate the signals feed
 * uses, so the chart panel can't leak levels a user hasn't paid for.
 */
import 'server-only'
import { createClient } from '@/lib/supabase/server'
import { canAccess } from '@/lib/admin'
import { effectiveTierForFeatures } from '@/lib/demo'
import type { SubscriptionTier } from '@/lib/types'
import {
  marketState, trendStrength, confidencePct, volatilityLevel,
  momentumConsistency, marketStructure, sessionLabel,
  type MarketState, type Strength, type VolLevel, type Consistency, type Structure,
} from '@/lib/market-language'
import { ENGINE_TIMEFRAME_LABEL } from '@/lib/tradingview'

const STALE_MS = 15 * 60_000

export interface SignalContext {
  available:     boolean
  locked:        boolean              // true = exists but above viewer's tier
  direction?:    string
  entry?:        number | null
  stop_loss?:    number | null
  take_profit?:  number | null
  risk_reward?:  number | null
  confidence?:   number | null
  status?:       string
  age_label?:    string
  reason?:       string
}

export interface SymbolIntel {
  symbol:            string
  available:         boolean          // a regime snapshot exists
  engine_timeframe:  string           // the TF the engine read was computed on
  scanned_at:        string | null
  age_label:         string | null
  stale:             boolean
  state:             MarketState | null
  regime_raw:        string | null
  confidence:        number | null    // 0–100, from DER
  trend_strength:    Strength | null
  volatility:        VolLevel | null
  momentum:          Consistency | null
  structure:         Structure | null
  session:           string | null
  signal:            SignalContext
  reason?:           string
}

function ageLabel(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  if (!Number.isFinite(ms)) return 'a while ago'
  const m = Math.floor(ms / 60_000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m} min ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

/** Candidate symbols to match against engine rows (BTC → BTCUSDT/BTCUSD). */
function candidates(raw: string): string[] {
  const s = raw.toUpperCase().replace('/', '').trim()
  const set = new Set<string>([s])
  if (!s.endsWith('USDT') && !s.endsWith('USD') && !s.endsWith('USDC')) {
    set.add(`${s}USDT`)
    set.add(`${s}USD`)
  }
  return [...set]
}

const EMPTY_SIGNAL: SignalContext = { available: false, locked: false }

export async function composeSymbolIntel(rawSymbol: string): Promise<SymbolIntel> {
  const symbol = rawSymbol.toUpperCase().replace('/', '').trim()
  const cands  = candidates(symbol)

  const base: SymbolIntel = {
    symbol,
    available: false,
    engine_timeframe: ENGINE_TIMEFRAME_LABEL,
    scanned_at: null, age_label: null, stale: false,
    state: null, regime_raw: null, confidence: null,
    trend_strength: null, volatility: null, momentum: null, structure: null,
    session: null,
    signal: EMPTY_SIGNAL,
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ...base, reason: 'Not authenticated' }

  // Effective tier for the signal-edge gate.
  const { data: profile } = await supabase
    .from('profiles')
    .select('subscription_tier, account_type')
    .eq('id', user.id).single()
  const rawTier = (profile?.subscription_tier ?? 'free') as SubscriptionTier
  const tier    = effectiveTierForFeatures(user.email, rawTier, profile?.account_type)

  // ── Regime snapshot (latest matching candidate) ────────────────────────
  const { data: snaps } = await supabase
    .from('regime_snapshots')
    .select('symbol, timeframe, regime, der_score, autocorr_score, atr_pct, session, scanned_at')
    .in('symbol', cands)
    .order('scanned_at', { ascending: false })
    .limit(1)
  const snap = snaps?.[0]

  let intel: SymbolIntel = base
  if (snap) {
    const age = Date.now() - new Date(snap.scanned_at).getTime()
    intel = {
      ...base,
      available:       true,
      engine_timeframe: snap.timeframe || ENGINE_TIMEFRAME_LABEL,
      scanned_at:      snap.scanned_at,
      age_label:       ageLabel(snap.scanned_at),
      stale:           age > STALE_MS,
      state:           marketState(snap.regime),
      regime_raw:      snap.regime ?? null,
      confidence:      confidencePct(snap.der_score),
      trend_strength:  trendStrength(snap.der_score),
      volatility:      volatilityLevel(snap.atr_pct),
      momentum:        momentumConsistency(snap.autocorr_score),
      structure:       marketStructure(snap.regime),
      session:         sessionLabel(snap.session),
    }
  } else {
    intel = { ...base, reason: 'No regime scan on record for this instrument yet.' }
  }

  // ── Latest signal (tier-gated edge) ────────────────────────────────────
  const { data: sigs } = await supabase
    .from('signals')
    .select('pair, direction, entry_price, stop_loss, take_profit_1, risk_reward, confidence_score, tier_required, status, published_at')
    .in('pair', cands)
    .order('published_at', { ascending: false })
    .limit(1)
  const sig = sigs?.[0]

  if (sig) {
    const required = (sig.tier_required ?? 'starter') as SubscriptionTier
    const allowed  = canAccess(user.email, tier, required)
    intel.signal = allowed
      ? {
          available: true, locked: false,
          direction:   sig.direction,
          entry:       sig.entry_price,
          stop_loss:   sig.stop_loss,
          take_profit: sig.take_profit_1,
          risk_reward: sig.risk_reward,
          confidence:  sig.confidence_score,
          status:      sig.status,
          age_label:   ageLabel(sig.published_at),
        }
      : {
          available: true, locked: true,
          direction: sig.direction, status: sig.status,
          age_label: ageLabel(sig.published_at),
          reason: `Upgrade to ${required} to view entry, stop, and targets.`,
        }
  }

  return intel
}
