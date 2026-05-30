/**
 * Growth Engine — scheduler runtime.
 *
 * publishOne(scheduledId) — atomic-ish workflow:
 *   1. Read the scheduled_posts row + the underlying content_item.
 *   2. Format the content for the target channel.
 *   3. Hand off to the channel adapter (Telegram wired; others stubbed).
 *   4. Persist a growth_post_attempts row.
 *   5. Update scheduled_posts → 'posted' or 'failed'.
 *
 * The flow is designed so a future cron job (Vercel cron, GitHub
 * Action, etc.) can call publishDue() to drain the queue. For Phase
 * 2 the admin UI calls publishOne() directly via the post-now route.
 */
import { createClient as serviceClient, type SupabaseClient } from '@supabase/supabase-js'
import {
  formatForChannel, type ContentInput, type BrandInput, type Channel,
} from './channels'
import { postToTelegram, type AdapterResult } from './adapters/telegram'

function svc(): SupabaseClient {
  return serviceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

export interface PublishOutcome {
  ok:          boolean
  attempt_id:  string
  external_id?: string
  external_url?: string
  error?:       string
}

async function postViaAdapter(channel: Channel, text: string): Promise<AdapterResult> {
  switch (channel) {
    case 'telegram':
      return postToTelegram(text)

    // Stubs — return a clear "not wired" error so the audit log shows
    // why nothing happened. Phase 2 ships the formatter for every
    // channel; actual posting is incremental as we add SDK keys.
    case 'x':
    case 'discord':
    case 'linkedin':
    case 'instagram':
    case 'facebook':
    case 'youtube':
    case 'whatsapp_channel':
    case 'instagram_reels':
    case 'youtube_shorts':
      return {
        ok:    false,
        error: `Channel "${channel}" formatter is wired but the posting adapter isn't configured yet. Add credentials + import the SDK in lib/growth/adapters/${channel}.ts.`,
      }
  }
}

export async function publishOne(scheduledId: string): Promise<PublishOutcome> {
  const db = svc()
  const startedAt = Date.now()

  // ── Load the queued row + content + brand settings.
  const { data: sched, error: schedErr } = await db
    .from('growth_scheduled_posts')
    .select('id, content_id, channel, status, attempts, body_override, hero_image_url')
    .eq('id', scheduledId)
    .single()

  if (schedErr || !sched) {
    return { ok: false, attempt_id: '', error: 'scheduled_post not found' }
  }
  if (sched.status !== 'queued') {
    return { ok: false, attempt_id: '', error: `cannot publish — current status is "${sched.status}"` }
  }

  const [{ data: content }, { data: brand }] = await Promise.all([
    db.from('growth_content_items').select('*').eq('id', sched.content_id).single(),
    db.from('growth_brand_settings').select('*').eq('id', 1).single(),
  ])
  if (!content) {
    return { ok: false, attempt_id: '', error: 'content_item missing' }
  }

  // Flip to 'posting' so a parallel cron tick can't claim the same row.
  await db.from('growth_scheduled_posts')
    .update({ status: 'posting', last_attempt_at: new Date().toISOString() })
    .eq('id', scheduledId)
    .eq('status', 'queued')   // optimistic guard

  // Format + post.
  const ci: ContentInput = {
    title:        content.title,
    summary:      content.summary,
    body_md:      sched.body_override ?? content.body_md,
    tags:         content.tags ?? [],
    is_synthetic: !!content.is_synthetic,
    disclaimer:   content.disclaimer,
    cta_text:     content.cta_text,
    cta_url:      content.cta_url,
  }
  const bi: BrandInput = brand
    ? {
        signature:       brand.signature,
        default_cta:     brand.default_cta,
        default_cta_url: brand.default_cta_url,
        legal_footer:    brand.legal_footer,
        social:          brand.social ?? {},
      }
    : {}

  const formatted = formatForChannel(sched.channel as Channel, ci, bi)
  const adapter   = await postViaAdapter(sched.channel as Channel, formatted.text)
  const durationMs = Date.now() - startedAt
  const nextAttempt = (sched.attempts ?? 0) + 1

  // Append an attempt row (audit log).
  const { data: attemptRow } = await db
    .from('growth_post_attempts')
    .insert({
      scheduled_id:    scheduledId,
      channel:         sched.channel,
      attempt_number:  nextAttempt,
      succeeded:       adapter.ok,
      duration_ms:     durationMs,
      response:        adapter.response ?? null,
      error:           adapter.error ?? null,
    })
    .select('id')
    .single()

  if (adapter.ok) {
    await db.from('growth_scheduled_posts').update({
      status:          'posted',
      posted_at:       new Date().toISOString(),
      external_id:     adapter.external_id ?? null,
      external_url:    adapter.external_url ?? null,
      attempts:        nextAttempt,
      last_attempt_at: new Date().toISOString(),
      last_error:      null,
    }).eq('id', scheduledId)
    return {
      ok:           true,
      attempt_id:   attemptRow?.id ?? '',
      external_id:  adapter.external_id,
      external_url: adapter.external_url,
    }
  }

  await db.from('growth_scheduled_posts').update({
    status:          'failed',
    attempts:        nextAttempt,
    last_attempt_at: new Date().toISOString(),
    last_error:      adapter.error ?? 'unknown',
  }).eq('id', scheduledId)

  return {
    ok:         false,
    attempt_id: attemptRow?.id ?? '',
    error:      adapter.error,
  }
}
