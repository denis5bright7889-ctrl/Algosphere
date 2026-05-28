/**
 * Product entitlements — the server-authoritative segmentation of the
 * single subscription ladder (free<starter<premium<vip) into the three
 * AlgoSphere business layers:
 *
 *   • AlgoSphere Signals™   — signals/analytics only, NO execution
 *   • AlgoSphere Quant™     — user-owned broker connectivity + execution
 *   • AlgoSphere AutoFund™  — AI-assisted autonomous execution + perf fee
 *
 * Mirrors the `intelEntitlements(tier)` pattern in
 * ./intelligence-entitlements: one rank-keyed capability table, derived
 * everywhere, never hand-rolled per route/page. This is the contract the
 * execution chokepoints (broker promote-live, the engine /execute auth)
 * and the product portals read from — so capability lives in ONE place.
 *
 * Tier→layer mapping is grounded in the plan copy in ./plans:
 *   free    → Signals only (delayed)
 *   starter → Signals + Quant read-only ("connect ONE … read-only")
 *   premium → Signals + Quant semi-auto ("semi-automated execution")
 *   vip     → + AutoFund autonomous   ("fully automated … AI execution")
 */
import type { SubscriptionTier } from '@/lib/types'

const RANK: Record<SubscriptionTier, number> = {
  free: 0, starter: 1, premium: 2, vip: 3,
}

export type ProductLayer = 'signals' | 'quant' | 'autofund'

export const PRODUCT_NAMES: Record<ProductLayer, string> = {
  signals:  'AlgoSphere Signals™',
  quant:    'AlgoSphere Quant™',
  autofund: 'AlgoSphere AutoFund™',
}

/**
 * Execution mode — the ceiling on what a broker connection may do.
 * Strictly increasing capability; gates compare by rank, never equality.
 *   none → read_only → manual → semi_auto → autonomous
 */
export type ExecutionMode =
  'none' | 'read_only' | 'manual' | 'semi_auto' | 'autonomous'

const EXEC_RANK: Record<ExecutionMode, number> = {
  none: 0, read_only: 1, manual: 2, semi_auto: 3, autonomous: 4,
}

export interface ProductEntitlements {
  tier:               SubscriptionTier
  /** Which product portals this tier may open. */
  products:           Record<ProductLayer, boolean>
  /** Highest execution capability this tier may exercise on a broker. */
  maxExecutionMode:   ExecutionMode
  /** May flip a broker connection from paper/testnet → live money. */
  allowLiveExecution: boolean
  /** AutoFund: AI may place orders without per-trade user confirmation. */
  allowAutonomous:    boolean
  /** AutoFund: eligible for performance-fee billing. */
  performanceFee:     boolean
  /** Max linked broker accounts (multi-account orchestration). */
  maxBrokerAccounts:  number
  /** AutoFund per-order lot ceiling (lot-tier access). 0 = N/A. */
  maxLotSize:         number
  /** Signal freshness for the Signals™ layer. */
  signalAccess:       'delayed' | 'live'
  signalDelayMinutes: number
}

type ProductRow = Omit<ProductEntitlements, 'tier'>

const TABLE: Record<number, ProductRow> = {
  // free — Signals™ only, delayed, zero execution surface.
  0: {
    products: { signals: true, quant: false, autofund: false },
    maxExecutionMode: 'none', allowLiveExecution: false, allowAutonomous: false,
    performanceFee: false, maxBrokerAccounts: 0, maxLotSize: 0,
    signalAccess: 'delayed', signalDelayMinutes: 60,
  },
  // starter — Quant™ unlocked but read-only (connect, observe, no live flip).
  1: {
    products: { signals: true, quant: true, autofund: false },
    maxExecutionMode: 'read_only', allowLiveExecution: false, allowAutonomous: false,
    performanceFee: false, maxBrokerAccounts: 1, maxLotSize: 0,
    signalAccess: 'delayed', signalDelayMinutes: 15,
  },
  // premium — Quant™ semi-automated, live money allowed after readiness gate.
  2: {
    products: { signals: true, quant: true, autofund: false },
    maxExecutionMode: 'semi_auto', allowLiveExecution: true, allowAutonomous: false,
    performanceFee: false, maxBrokerAccounts: 3, maxLotSize: 0,
    signalAccess: 'live', signalDelayMinutes: 0,
  },
  // vip — AutoFund™ autonomous execution + performance fee + lot-tier.
  3: {
    products: { signals: true, quant: true, autofund: true },
    maxExecutionMode: 'autonomous', allowLiveExecution: true, allowAutonomous: true,
    performanceFee: true, maxBrokerAccounts: 25, maxLotSize: 50,
    signalAccess: 'live', signalDelayMinutes: 0,
  },
}

/** Resolve the full entitlement set for a tier (defaults to free on miss). */
export function productEntitlements(tier: SubscriptionTier): ProductEntitlements {
  const rank = RANK[tier] ?? 0
  return { ...TABLE[rank]!, tier }
}

/** May this tier open the given product portal? */
export function canAccessProduct(tier: SubscriptionTier, product: ProductLayer): boolean {
  return productEntitlements(tier).products[product]
}

/** Is the requested execution mode within this tier's ceiling? */
export function canUseExecutionMode(tier: SubscriptionTier, mode: ExecutionMode): boolean {
  return EXEC_RANK[mode] <= EXEC_RANK[productEntitlements(tier).maxExecutionMode]
}

/** May this tier promote a broker connection to live money? */
export function canPromoteLive(tier: SubscriptionTier): boolean {
  return productEntitlements(tier).allowLiveExecution
}

/** The highest product layer a tier belongs to — for portal landing/upsell. */
export function primaryProduct(tier: SubscriptionTier): ProductLayer {
  const e = productEntitlements(tier)
  if (e.products.autofund) return 'autofund'
  if (e.products.quant)    return 'quant'
  return 'signals'
}
