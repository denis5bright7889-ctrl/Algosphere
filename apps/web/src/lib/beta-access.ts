/**
 * AlgoSphere Quant — Open Beta Access Flag
 *
 * When OPEN_BETA_FREE_ACCESS=true on the server, ALL authenticated users
 * who click "Get Starter / Pro / VIP" are instantly granted the live plan
 * without payment. This is for the build / closed-test phase only.
 *
 * SECURITY:
 * - Check is server-side only. Frontend cannot tamper with it.
 * - Requires the user to be authenticated (anonymous visitors are still
 *   redirected to signup).
 * - REMOVE OR SET TO FALSE before charging real customers.
 *
 * Flip the flag in Vercel env vars (or apps/web/.env.local):
 *   OPEN_BETA_FREE_ACCESS=true   # everyone gets instant activation
 *   OPEN_BETA_FREE_ACCESS=false  # require payment (admin still bypasses)
 */
export function isBetaFreeAccessEnabled(): boolean {
  return process.env.OPEN_BETA_FREE_ACCESS === 'true'
}
