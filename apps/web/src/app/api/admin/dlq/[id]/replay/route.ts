import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as serviceClient } from '@supabase/supabase-js'
import { isAdmin } from '@/lib/admin'

/**
 * POST /api/admin/dlq/[id]/replay
 *
 * Replay a dead-lettered job via the replay_dlq_job() RPC. Idempotent: a
 * second call returns the same replay_job_id and does not double-enqueue.
 * The RPC re-activates the original copy_jobs row (honors UNIQUE
 * (signal_event_id, subscription_id)); the executor picks it up next claim.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !isAdmin(user.email)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const svc = serviceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
  const { data, error } = await svc.rpc('replay_dlq_job', { p_dlq_id: id })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await svc.from('audit_logs').insert({
    actor_id: user.id, actor_email: user.email,
    action: 'dlq.replay', resource_type: 'copy_jobs_dlq', resource_id: id,
    after_state: { replay_job_id: data ?? null },
  }).then(() => {}, () => {})

  return NextResponse.json({ ok: true, replay_job_id: data ?? null })
}
