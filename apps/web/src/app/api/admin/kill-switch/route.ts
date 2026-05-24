import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as serviceClient } from '@supabase/supabase-js'
import { isAdmin } from '@/lib/admin'

/**
 * GET  /api/admin/kill-switch — current state.
 * POST /api/admin/kill-switch — { active: boolean, reason?: string }
 *   Toggles via the set_global_kill_switch() RPC (SECURITY DEFINER). The
 *   engine reads global_risk_state on every /execute (cached 5s), so the
 *   flip propagates within seconds. Reduce-only orders are permitted during
 *   a kill so positions can still be flattened.
 *
 * Admin-only. Writes go through the service-role client because the RPC
 * is granted to service_role and the action is global.
 */
async function _admin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !isAdmin(user.email)) return null
  return user
}

function _svc() {
  return serviceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

export async function GET() {
  if (!(await _admin())) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  const svc = _svc()
  const { data, error } = await svc.from('global_risk_state')
    .select('kill_switch, reason, activated_by, activated_at, updated_at')
    .eq('id', true).maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ state: data })
}

export async function POST(req: Request) {
  const user = await _admin()
  if (!user) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  let body: { active?: boolean; reason?: string } = {}
  try { body = await req.json() } catch { /* empty body ok for clear */ }
  if (typeof body.active !== 'boolean') {
    return NextResponse.json({ error: 'body.active boolean required' }, { status: 400 })
  }

  const svc = _svc()
  const { error } = await svc.rpc('set_global_kill_switch', {
    p_active: body.active,
    p_reason: body.active ? (body.reason ?? 'admin toggle') : null,
    p_actor:  user.email ?? 'admin',
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Audit
  await svc.from('audit_logs').insert({
    actor_id: user.id, actor_email: user.email,
    action: body.active ? 'risk.kill_switch.activate' : 'risk.kill_switch.clear',
    resource_type: 'global_risk_state', resource_id: null,
    after_state: { active: body.active, reason: body.reason ?? null },
  }).then(() => {}, () => {})

  return NextResponse.json({ ok: true, active: body.active })
}
