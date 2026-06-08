/**
 * POST /api/feedback/vote — cast or change a vote/reaction.
 *
 * Two modes (validated by the lib + the DB CHECK):
 *   - submission_id set → upvote/downvote a feature request
 *   - target_kind + target_id set → react to a content target
 *
 * Upsert behaviour: if the user already has a vote/reaction on that
 * target/submission, the row is UPDATED to the new reaction value
 * (toggle / switch). Sending the SAME reaction that's already on
 * record removes the row (vote toggle-off pattern).
 *
 * DELETE /api/feedback/vote with the same body removes the vote
 * explicitly without the toggle semantics.
 */
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { VoteInputSchema } from '@/lib/feedback'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json().catch(() => ({}))
  const parsed = VoteInputSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', details: parsed.error.format() },
      { status: 422 },
    )
  }
  const v = parsed.data

  // Look up the existing vote (if any). The two partial unique indexes
  // on (user_id, submission_id) and (user_id, target_kind, target_id)
  // guarantee at most one match per mode.
  let existingQuery = supabase
    .from('feedback_votes')
    .select('id, reaction')
    .eq('user_id', user.id)
  if (v.submission_id) {
    existingQuery = existingQuery.eq('submission_id', v.submission_id)
  } else {
    existingQuery = existingQuery
      .eq('target_kind', v.target_kind!)
      .eq('target_id',   v.target_id!)
  }
  const { data: existing } = await existingQuery.maybeSingle()

  // Same reaction submitted twice → toggle off (delete).
  if (existing && existing.reaction === v.reaction) {
    const { error: delErr } = await supabase
      .from('feedback_votes').delete().eq('id', existing.id)
    if (delErr) {
      return NextResponse.json({ error: delErr.message }, { status: 500 })
    }
    return NextResponse.json({ ok: true, action: 'removed' })
  }

  // Different reaction on the same target → update.
  if (existing) {
    const { error: updErr } = await supabase
      .from('feedback_votes').update({ reaction: v.reaction }).eq('id', existing.id)
    if (updErr) {
      return NextResponse.json({ error: updErr.message }, { status: 500 })
    }
    return NextResponse.json({ ok: true, action: 'switched', from: existing.reaction, to: v.reaction })
  }

  // First-time vote on this target → insert.
  const { error: insErr } = await supabase
    .from('feedback_votes')
    .insert({
      user_id:       user.id,
      submission_id: v.submission_id ?? null,
      target_kind:   v.target_kind   ?? null,
      target_id:     v.target_id     ?? null,
      reaction:      v.reaction,
    })
  if (insErr) {
    return NextResponse.json({ error: insErr.message }, { status: 500 })
  }
  return NextResponse.json({ ok: true, action: 'added' })
}
