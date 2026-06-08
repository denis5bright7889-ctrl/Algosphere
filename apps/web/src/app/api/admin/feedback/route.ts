/**
 * GET  /api/admin/feedback         — list ALL submissions for triage
 * PATCH /api/admin/feedback?id=... — update status and/or admin_response
 *
 * Admin-only. Uses service-role client so RLS is bypassed — same
 * pattern as /api/admin/growth/* and /api/admin/signals/*.
 *
 * GET query params:
 *   limit, offset, type, status, severity (open feedback first by default)
 *
 * PATCH body:
 *   { status?: FeedbackStatus, admin_response?: string }
 * At least one of status / admin_response is required. When
 * admin_response is set, responded_at + responded_by are stamped
 * automatically.
 */
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as serviceClient } from '@supabase/supabase-js'
import { isAdmin } from '@/lib/admin'
import {
  AdminUpdateSchema, FEEDBACK_TYPES, FEEDBACK_STATUSES, BUG_SEVERITIES,
} from '@/lib/feedback'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const MAX_LIMIT = 200

function svc() {
  return serviceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

async function gate() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  if (!isAdmin(user.email)) return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  return { user }
}

export async function GET(req: Request) {
  const g = await gate()
  if ('error' in g) return g.error

  const url = new URL(req.url)
  const limit    = Math.min(MAX_LIMIT, Math.max(1, Number(url.searchParams.get('limit')  ?? '50')))
  const offset   = Math.max(0, Number(url.searchParams.get('offset') ?? '0'))
  const typeQ     = url.searchParams.get('type')
  const statusQ   = url.searchParams.get('status')
  const severityQ = url.searchParams.get('severity')

  const db = svc()
  let q = db
    .from('feedback_submissions')
    .select(
      'id, user_id, type, rating, subject, body, target_kind, target_id, severity, status, admin_response, responded_at, responded_by, source, created_at, updated_at',
      { count: 'exact' },
    )
    .is('deleted_at', null)
    // Open + in_review first; everything else after, sorted by recency.
    // Default sort intentionally surfaces the triage queue at the top.
    .order('status',     { ascending: true })
    .order('severity',   { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (typeQ && (FEEDBACK_TYPES as readonly string[]).includes(typeQ))     q = q.eq('type', typeQ)
  if (statusQ && (FEEDBACK_STATUSES as readonly string[]).includes(statusQ)) q = q.eq('status', statusQ)
  if (severityQ && (BUG_SEVERITIES as readonly string[]).includes(severityQ)) q = q.eq('severity', severityQ)

  const { data, error, count } = await q
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({
    submissions: data ?? [],
    total:       count ?? 0,
    limit,
    offset,
  })
}

export async function PATCH(req: Request) {
  const g = await gate()
  if ('error' in g) return g.error

  const url = new URL(req.url)
  const id = url.searchParams.get('id')
  if (!id) {
    return NextResponse.json({ error: 'id query param required' }, { status: 400 })
  }

  const body = await req.json().catch(() => ({}))
  const parsed = AdminUpdateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', details: parsed.error.format() },
      { status: 422 },
    )
  }

  const patch: Record<string, unknown> = {}
  if (parsed.data.status)         patch.status         = parsed.data.status
  if (parsed.data.admin_response) {
    patch.admin_response = parsed.data.admin_response
    patch.responded_at   = new Date().toISOString()
    patch.responded_by   = g.user.id
    // Auto-flip to 'answered' when responding unless an explicit status
    // was provided (lets admins reply + close in one PATCH if they want).
    if (!parsed.data.status) patch.status = 'answered'
  }

  const db = svc()
  const { data: row, error } = await db
    .from('feedback_submissions')
    .update(patch)
    .eq('id', id)
    .select('id, status, admin_response, responded_at, responded_by, updated_at')
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ ok: true, submission: row })
}
