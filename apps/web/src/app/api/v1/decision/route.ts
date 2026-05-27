/**
 * AlgoSphere Quant — Public Decision API (VIP / institutional).
 *
 *   GET /api/v1/decision
 *   Authorization: Bearer aq_live_…
 *
 * The anti-reverse-engineering boundary. Returns ONLY the strict
 * consolidated decision — market_state, trade_bias, confidence, risk,
 * action, mds. NEVER raw indicators, engine scores, weights, formulas,
 * disagreement penalties, or any intermediate state.
 *
 * Auth / tier gate / rate limit / metering are handled by
 * authenticateApiKey(); this handler only projects the strict object.
 */
import { NextResponse } from 'next/server'
import { authenticateApiKey, isApiError } from '@/lib/api-auth'
import { composeDecision } from '@/lib/decision-brain'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const ctx = await authenticateApiKey(request, 'intelligence:read')
  if (isApiError(ctx)) return ctx

  try {
    const decision = await composeDecision()
    // Project to the strict contract ONLY. Nothing else from the rich
    // object (explanation, momentum_state, flow_bias, engine snapshot, …)
    // crosses the API boundary.
    const { mds, confidence, market_state, trade_bias, risk, action } = decision.strict
    return NextResponse.json(
      { mds, confidence, market_state, trade_bias, risk, action },
      { headers: { 'Cache-Control': 'private, max-age=20' } },
    )
  } catch {
    return NextResponse.json({ error: 'Decision temporarily unavailable' }, { status: 503 })
  }
}
