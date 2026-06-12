/**
 * Brand constants — single source of truth for institutional contact
 * details, legal addressing, and brand strings used across
 * marketing + dashboard surfaces.
 *
 * Update here once → every page/email/template updates.
 */

export const BRAND_NAME        = 'AlgoSphere Quant'
export const BRAND_DOMAIN      = 'algospherequant.com'
export const BRAND_URL         = 'https://algospherequant.com'

/** Canonical institutional contact. Use this for anything that
 *  doesn't have a more specific channel (privacy / legal / press). */
export const CONTACT_EMAIL     = 'info@algospherequant.com'

/** Channel-specific aliases — all currently route to CONTACT_EMAIL
 *  until dedicated inboxes are wired. Keeping them named lets the UI
 *  show the right intent ("for privacy questions: ...") and we can
 *  swap them in one place when sub-addresses land. */
export const SUPPORT_EMAIL     = CONTACT_EMAIL
export const PRIVACY_EMAIL     = CONTACT_EMAIL
export const LEGAL_EMAIL       = CONTACT_EMAIL
export const PRESS_EMAIL       = CONTACT_EMAIL
export const INVESTORS_EMAIL   = CONTACT_EMAIL
export const FOUNDERS_EMAIL    = CONTACT_EMAIL

export const BRAND_TAGLINE     = 'Every strategy must earn the right to trade live.'
