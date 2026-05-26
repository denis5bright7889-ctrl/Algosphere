import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  getEngineStatus, getRiskTelemetry, getCircuitBreakers,
} from '@/lib/engine-client'

export const dynamic = 'force-dynamic'

/**
 * Consolidated engine state for the Auto Trading UI. Auth-gated (a
 * signed-in user is required), then fans out three signal-engine read
 * endpoints in parallel and returns one payload. Each section is
 * independently OK/Err — the UI renders honest per-section error states
 * rather than 500-ing the whole panel when one read fails.
 */
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const [status, risk, circuit] = await Promise.all([
    getEngineStatus(),
    getRiskTelemetry(),
    getCircuitBreakers(),
  ])

  return NextResponse.json({
    status,
    risk,
    circuit,
    fetched_at: new Date().toISOString(),
  })
}
