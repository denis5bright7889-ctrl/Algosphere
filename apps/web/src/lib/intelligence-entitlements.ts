/**
 * On-chain Intelligence — access bands.
 *
 * Separate from the broad FEATURE_CATALOG in ./entitlements (left
 * untouched). This file owns ONLY the Intelligence module's
 * behaviour: live vs delayed data, AI overlays, advanced heatmap,
 * streaming, API, and row caps.
 *
 * Brief tier names → AlgoSphere ladder (free<starter<premium<vip):
 *   FREE → free · PRO → starter · ELITE → premium · INSTITUTIONAL → vip
 *
 * Every Intelligence API route + page derives behaviour from
 * `intelEntitlements(tier)` — no per-page hand-rolled gating.
 */
import type { SubscriptionTier } from '@/lib/types'

const RANK: Record<SubscriptionTier, number> = {
  free: 0, starter: 1, premium: 2, vip: 3,
}

export interface IntelEntitlements {
  band:            'FREE' | 'PRO' | 'ELITE' | 'INSTITUTIONAL'
  liveData:        boolean
  delayMinutes:    number
  dashboards:      'limited' | 'full'
  whaleAlerts:     boolean
  aiNarratives:    boolean
  advancedHeatmap: boolean
  streaming:       boolean
  apiAccess:       boolean
  rowLimit:        number
}

const TABLE: Record<number, IntelEntitlements> = {
  0: { band: 'FREE',          liveData: false, delayMinutes: 60, dashboards: 'limited',
       whaleAlerts: false, aiNarratives: false, advancedHeatmap: false, streaming: false, apiAccess: false, rowLimit: 10 },
  1: { band: 'PRO',           liveData: false, delayMinutes: 15, dashboards: 'full',
       whaleAlerts: false, aiNarratives: false, advancedHeatmap: false, streaming: false, apiAccess: false, rowLimit: 25 },
  2: { band: 'ELITE',         liveData: true,  delayMinutes: 0,  dashboards: 'full',
       whaleAlerts: true,  aiNarratives: true,  advancedHeatmap: false, streaming: false, apiAccess: false, rowLimit: 50 },
  3: { band: 'INSTITUTIONAL', liveData: true,  delayMinutes: 0,  dashboards: 'full',
       whaleAlerts: true,  aiNarratives: true,  advancedHeatmap: true,  streaming: true,  apiAccess: true,  rowLimit: 100 },
}

export function intelEntitlements(tier: SubscriptionTier): IntelEntitlements {
  return TABLE[RANK[tier] ?? 0]!
}
