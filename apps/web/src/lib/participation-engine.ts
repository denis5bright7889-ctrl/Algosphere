/**
 * Participation Engine — institutional "who is driving price" decomposition.
 *
 * Per the brief: separate retail / whale / smart-money / passive / aggressive
 * participation, then expose quality, strength, and imbalance — never raw
 * order-flow numbers.
 *
 * Coverage on current data sources:
 *   Smart Money       Nansen tokenScreener (only_smart_money=true)
 *   Whales            Nansen tokenScreener ordered by netflow (gross + side)
 *   Aggression        derived from buy_volume vs sell_volume on the same
 *                     screener result — a directional bias proxy
 *   Retail            NOT WIRED — would need exchange-side aggregates
 *                     (small-lot vs large-lot) we don't have today. The
 *                     view reports this honestly rather than fabricating.
 *
 * Each per-asset view exposes:
 *   - quality       (High / Moderate / Low) — alignment of SM + whales
 *   - strength      (0..100) — composite participation intensity
 *   - imbalance     (Buyers-led / Sellers-led / Balanced) — net direction
 *   - composition   per-channel breakdown
 *   - narrative     one-line institutional read
 */
import 'server-only'
import { tokenScreener, isNansenConfigured, type NansenChain } from '@/lib/nansen'

export type ParticipationQuality   = 'High' | 'Moderate' | 'Low' | 'N/A'
export type ParticipationImbalance = 'Buyers-led' | 'Sellers-led' | 'Balanced' | 'Quiet' | 'N/A'

export interface ParticipationChannel {
  name:        'Smart Money' | 'Whales' | 'Aggression' | 'Retail'
  /** 0..1 — how strongly THIS channel is engaged for the asset. */
  intensity:   number
  /** Net directional lean from this channel. */
  bias:        'Bullish' | 'Bearish' | 'Neutral' | 'N/A'
  /** Short institutional descriptor; never a raw number. */
  signal:      string
  available:   boolean
}

export interface ParticipationView {
  symbol:        string
  chain:         string
  quality:       ParticipationQuality
  strength:      number               // 0..100 composite
  imbalance:     ParticipationImbalance
  channels:      ParticipationChannel[]
  narrative:     string
  generated_at:  string
  partial:       boolean
}

// ── Helpers ──────────────────────────────────────────────────────────────

function clamp01(v: number): number { return Math.max(0, Math.min(1, v)) }

interface ScreenerRow {
  chain:             string
  token_address:     string
  token_symbol:      string
  buy_volume:        number
  sell_volume:       number
  netflow:           number
  inflow_fdv_ratio:  number
  outflow_fdv_ratio: number
  volume:            number
}

function buildView(row: ScreenerRow): ParticipationView {
  const total      = row.buy_volume + row.sell_volume
  const buyShare   = total > 0 ? row.buy_volume  / total : 0.5
  const sellShare  = total > 0 ? row.sell_volume / total : 0.5
  const aggression = Math.abs(buyShare - sellShare)              // 0..1 — how one-sided

  // Smart-money channel: presence + direction from net flow vs FDV ratios
  const smIntensity = clamp01(Math.max(row.inflow_fdv_ratio || 0, row.outflow_fdv_ratio || 0) * 60)
  const smBias: ParticipationChannel['bias'] =
    (row.inflow_fdv_ratio || 0)  > (row.outflow_fdv_ratio || 0) * 1.1 ? 'Bullish' :
    (row.outflow_fdv_ratio || 0) > (row.inflow_fdv_ratio || 0)  * 1.1 ? 'Bearish' : 'Neutral'
  const smSignal =
    smIntensity >= 0.5 ? `Smart money meaningfully engaged (${smBias === 'Bullish' ? 'accumulating' : smBias === 'Bearish' ? 'distributing' : 'neutral'})`
                       : smIntensity >= 0.2 ? 'Smart money lightly engaged' : 'Smart money quiet'

  // Whale channel: gross netflow scale vs token volume — proxy for whale dominance
  const whaleIntensity = clamp01(Math.abs(row.netflow || 0) / Math.max(row.volume || 1, 1) * 2)
  const whaleBias: ParticipationChannel['bias'] =
    (row.netflow || 0) >  0 ? 'Bullish' :
    (row.netflow || 0) <  0 ? 'Bearish' : 'Neutral'
  const whaleSignal =
    whaleIntensity >= 0.5 ? `Whales ${whaleBias === 'Bullish' ? 'net accumulating' : whaleBias === 'Bearish' ? 'net distributing' : 'neutral'}`
                          : whaleIntensity >= 0.2 ? 'Whales lightly engaged' : 'Whales quiet'

  // Aggression channel: directional one-sidedness of order flow
  const aggressionBias: ParticipationChannel['bias'] =
    buyShare > 0.55 ? 'Bullish' :
    buyShare < 0.45 ? 'Bearish' : 'Neutral'
  const aggressionSignal =
    aggression >= 0.3 ? `Aggressively ${aggressionBias === 'Bullish' ? 'bid' : 'offered'}` :
    aggression >= 0.1 ? 'Mild directional pressure' : 'Two-sided / balanced'

  const channels: ParticipationChannel[] = [
    { name: 'Smart Money', intensity: smIntensity,    bias: smBias,         signal: smSignal,          available: true },
    { name: 'Whales',      intensity: whaleIntensity, bias: whaleBias,      signal: whaleSignal,       available: true },
    { name: 'Aggression',  intensity: aggression,     bias: aggressionBias, signal: aggressionSignal,  available: true },
    { name: 'Retail',      intensity: 0,              bias: 'N/A',          signal: 'Requires exchange order-side aggregates (not yet wired)', available: false },
  ]

  // Composite quality: alignment of SM + Whales (same direction) when both engaged
  let quality: ParticipationQuality = 'N/A'
  const aligned = smBias !== 'Neutral' && smBias === whaleBias
  const opposed = (smBias === 'Bullish' && whaleBias === 'Bearish') || (smBias === 'Bearish' && whaleBias === 'Bullish')
  if      (aligned && smIntensity >= 0.3 && whaleIntensity >= 0.3) quality = 'High'
  else if (aligned)                                                 quality = 'Moderate'
  else if (opposed)                                                 quality = 'Low'
  else if (smIntensity < 0.2 && whaleIntensity < 0.2)               quality = 'N/A'
  else                                                              quality = 'Moderate'

  // Strength = mean of the available channel intensities, scaled 0..100
  const availableChannels = channels.filter((c) => c.available)
  const strength = Math.round(
    (availableChannels.reduce((s, c) => s + c.intensity, 0) / Math.max(availableChannels.length, 1)) * 100,
  )

  // Imbalance: net direction across SM + Whales + Aggression
  const bullVotes = channels.filter((c) => c.available && c.bias === 'Bullish').length
  const bearVotes = channels.filter((c) => c.available && c.bias === 'Bearish').length
  const imbalance: ParticipationImbalance =
    strength < 15                       ? 'Quiet' :
    bullVotes > bearVotes && bullVotes >= 2 ? 'Buyers-led' :
    bearVotes > bullVotes && bearVotes >= 2 ? 'Sellers-led' :
                                             'Balanced'

  const narrative = buildNarrative({ symbol: row.token_symbol, quality, imbalance, strength, smBias, whaleBias })

  return {
    symbol:       row.token_symbol,
    chain:        row.chain,
    quality,
    strength,
    imbalance,
    channels,
    narrative,
    generated_at: new Date().toISOString(),
    partial:      true,  // retail channel is N/A by design until exchange data is wired
  }
}

function buildNarrative(p: {
  symbol: string; quality: ParticipationQuality; imbalance: ParticipationImbalance;
  strength: number; smBias: ParticipationChannel['bias']; whaleBias: ParticipationChannel['bias']
}): string {
  if (p.imbalance === 'Quiet') return `${p.symbol}: participation muted, no notable cohort engaged.`
  const aligned = p.smBias !== 'Neutral' && p.smBias === p.whaleBias
  const direction = p.imbalance === 'Buyers-led' ? 'bid' : p.imbalance === 'Sellers-led' ? 'offered' : 'two-sided'
  const align = aligned ? ` Smart money and whales aligned ${p.smBias.toLowerCase()}.` : ' Cohorts mixed.'
  const qual = p.quality === 'High'    ? 'High-quality move' :
              p.quality === 'Moderate' ? 'Moderate-quality move' :
              p.quality === 'Low'      ? 'Conflicted move — caution' :
                                          'Activity light'
  return `${qual}.${align} Tape ${direction} (${p.strength}% intensity).`
}

// ── Public API ───────────────────────────────────────────────────────────

/** Composes the participation view for the top N tokens by smart-money buy volume. */
export async function composeParticipationBoard(opts: { window?: '1h'|'24h'|'7d'|'30d'; limit?: number } = {}): Promise<{ views: ParticipationView[]; partial: boolean; reason?: string }> {
  // `reason` is SANITIZED — never carries provider names, HTTP codes, or
  // credit wording. Pages must not render the raw `reason` string;
  // operators see the real provider error in /admin/intelligence-health.
  if (!isNansenConfigured()) {
    return { views: [], partial: true, reason: 'Participation provider unconfigured — on-chain data unavailable' }
  }
  try {
    const tokens = await tokenScreener({
      chains:    ['ethereum','solana','base'] as NansenChain[],
      timeframe: opts.window ?? '24h',
      orderBy:   'buy_volume',
      direction: 'DESC',
      limit:     opts.limit ?? 24,
    })
    const views = tokens
      .filter((t) => Number.isFinite(t.buy_volume) && (t.buy_volume + t.sell_volume) > 0)
      .map((t) => buildView({
        chain:             t.chain,
        token_address:     t.token_address,
        token_symbol:      t.token_symbol,
        buy_volume:        t.buy_volume,
        sell_volume:       t.sell_volume,
        netflow:           t.netflow,
        inflow_fdv_ratio:  t.inflow_fdv_ratio,
        outflow_fdv_ratio: t.outflow_fdv_ratio,
        volume:            t.volume,
      }))
    return { views, partial: true }
  } catch {
    return { views: [], partial: true, reason: 'Participation provider recalibrating — read resumes on the next cycle' }
  }
}
