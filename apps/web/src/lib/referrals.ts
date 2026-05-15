/**
 * AlgoSphere Quant — Referral / Affiliate helpers
 *
 * Referral codes are public, deterministic (md5(user_id)[:8]), and stored on
 * profiles.referral_code by the handle_new_user() trigger. Commission is a
 * percentage of the first paid subscription, accrued on payment approval.
 */
import { PLAN_PRICES_USD } from '@/lib/payments/binance'

export type ReferralStatus = 'signed_up' | 'converted' | 'paid'

export interface ReferralRow {
  id: string
  referrer_id: string
  referred_id: string
  commission_pct: number
  commission_paid: boolean
  commission_amount: number
  plan: string | null
  status: ReferralStatus
  created_at: string
  converted_at: string | null
  paid_at: string | null
}

/** Default affiliate cut (matches referrals.commission_pct DB default). */
export const DEFAULT_COMMISSION_PCT = 20

/** Build the shareable signup link for a referral code. */
export function referralLink(origin: string, code: string): string {
  return `${origin.replace(/\/$/, '')}/signup?ref=${encodeURIComponent(code)}`
}

/** Commission earned when a referred user pays for `plan`. */
export function commissionFor(plan: string, pct: number = DEFAULT_COMMISSION_PCT): number {
  const price = PLAN_PRICES_USD[plan] ?? 0
  return Math.round(price * (pct / 100) * 100) / 100
}

export interface ReferralStats {
  total:        number   // everyone who signed up via the link
  converted:    number   // became paying customers
  pendingUsd:   number   // earned, not yet paid out
  paidUsd:      number   // already paid out
  lifetimeUsd:  number   // pending + paid
  conversionRate: number // converted / total (0–100)
}

export function summarize(rows: ReferralRow[]): ReferralStats {
  const total     = rows.length
  const converted = rows.filter(r => r.status === 'converted' || r.status === 'paid').length
  const pendingUsd = rows
    .filter(r => r.status === 'converted')
    .reduce((s, r) => s + (r.commission_amount ?? 0), 0)
  const paidUsd = rows
    .filter(r => r.status === 'paid')
    .reduce((s, r) => s + (r.commission_amount ?? 0), 0)
  return {
    total,
    converted,
    pendingUsd:  round2(pendingUsd),
    paidUsd:     round2(paidUsd),
    lifetimeUsd: round2(pendingUsd + paidUsd),
    conversionRate: total ? Math.round((converted / total) * 100) : 0,
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}
