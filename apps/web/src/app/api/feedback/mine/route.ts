/**
 * GET /api/feedback/mine — paginated list of the caller's own
 * feedback submissions, newest first.
 *
 * Query params:
 *   limit:  number of rows (default 25, max 100)
 *   offset: skip N (default 0)
 *   type:   optional filter — 'rating' | 'question' | 'bug' | 'feature' | 'review'
 *   status: optional filter — any FeedbackStatus
 *
 * RLS guarantees the user only sees their own rows — no extra
 * server-side ownership check needed.
 */
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { FEEDBACK_TYPES, FEEDBACK_STATUSES } from '@/lib/feedback'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const MAX_LIMIT = 100

export async function GET(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const url = new URL(req.url)
  const limit  = Math.min(MAX_LIMIT, Math.max(1, Number(url.searchParams.get('limit')  ?? '25')))
  const offset = Math.max(0, Number(url.searchParams.get('offset') ?? '0'))
  const typeQ   = url.searchParams.get('type')
  const statusQ = url.searchParams.get('status')

  let q = supabase
    .from('feedback_submissions')
    .select('id, type, rating, subject, body, target_kind, target_id, severity, status, admin_response, responded_at, source, created_at, updated_at', { count: 'exact' })
    .eq('user_id', user.id)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (typeQ && (FEEDBACK_TYPES as readonly string[]).includes(typeQ)) {
    q = q.eq('type', typeQ)
  }
  if (statusQ && (FEEDBACK_STATUSES as readonly string[]).includes(statusQ)) {
    q = q.eq('status', statusQ)
  }

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
