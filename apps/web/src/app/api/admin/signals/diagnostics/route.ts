/**
 * GET /api/admin/signals/diagnostics — admin signal-pipeline observability.
 *
 * Proxies the engine's /api/v1/diagnostics/full (real production state:
 * per-symbol last evaluation + rejection reason, dead/missing symbols,
 * top rejection reasons, signal counts, drought, heartbeats, risk state).
 * Admin-only; never exposes the engine key to the client. Honest pass-through
 * of an unreachable/misconfigured engine so the dashboard shows the real
 * fault instead of a fabricated green.
 */
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isAdmin } from '@/lib/admin'
import { getSignalDiagnostics } from '@/lib/engine-client'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !isAdmin(user.email)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const result = await getSignalDiagnostics()
  if (!result.ok) {
    // 502 = the engine (upstream) is the problem, not this route. The UI
    // renders this as a RED "engine unreachable" banner.
    return NextResponse.json({ ok: false, error: result.error }, { status: 502 })
  }
  return NextResponse.json({ ok: true, diagnostics: result.data })
}
