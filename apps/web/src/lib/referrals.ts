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

// ─── Cookie attribution ─────────────────────────────────────────────
// Persists ?ref= across navigation so a user who arrives on the
// landing page with a code still gets attributed when they click
// through to /signup minutes later.

export const REF_COOKIE = 'algosphere_ref'
export const REF_COOKIE_MAX_AGE_S = 60 * 60 * 24 * 30   // 30 days

/** Best-effort cookie read on the client. Returns null off-browser. */
export function readRefCookie(): string | null {
  if (typeof document === 'undefined') return null
  const m = document.cookie.match(new RegExp('(?:^|; )' + REF_COOKIE + '=([^;]+)'))
  return m && m[1] ? decodeURIComponent(m[1]) : null
}

/**
 * Write the ref cookie. SameSite=Lax so it survives cross-site link
 * arrivals (Telegram/Twitter) without being sent on cross-site POST.
 * Not HttpOnly because the signup form needs to read it client-side
 * to forward into supabase.auth.signUp metadata.
 */
export function writeRefCookie(code: string): void {
  if (typeof document === 'undefined') return
  const clean = code.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 32)
  if (!clean) return
  document.cookie =
    `${REF_COOKIE}=${encodeURIComponent(clean)}` +
    `; Max-Age=${REF_COOKIE_MAX_AGE_S}` +
    `; Path=/` +
    `; SameSite=Lax`
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
