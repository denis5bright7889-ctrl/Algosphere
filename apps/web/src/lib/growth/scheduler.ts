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
import { postToDiscord } from './adapters/discord'
import { postToX } from './adapters/x'
import { postToLinkedIn } from './adapters/linkedin'
import {
  postToFacebook, postToFacebookVideo, postToInstagram, postToInstagramReels,
} from './adapters/meta'
import { postToYouTube, postToYouTubeShorts } from './adapters/youtube'
import { postToWhatsAppChannel } from './adapters/whatsapp'

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

async function postViaAdapter(
  channel: Channel,
  text:    string,
  ctx:     { hero?: string | null; kind?: string; imageUrl?: string | null; videoUrl?: string | null },
): Promise<AdapterResult> {
  const imageUrl = ctx.imageUrl ?? ctx.hero ?? undefined
  const videoUrl = ctx.videoUrl ?? undefined
  switch (channel) {
    case 'telegram':         return postToTelegram(text, { imageUrl, videoUrl })
    case 'discord':          return postToDiscord(text, { contentKind: ctx.kind, imageUrl, videoUrl })
    case 'x':                return postToX(text)
    case 'linkedin':         return postToLinkedIn(text)
    case 'facebook':         return videoUrl ? postToFacebookVideo(text, videoUrl) : postToFacebook(text)
    case 'instagram':        return postToInstagram(text, imageUrl)
    case 'instagram_reels':  return postToInstagramReels(text, videoUrl)
    case 'youtube':          return postToYouTube(text, videoUrl)
    case 'youtube_shorts':   return postToYouTubeShorts(text, videoUrl)
    case 'whatsapp_channel': return postToWhatsAppChannel(text)
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

  // Asset gate — when an automation rule declared asset_kinds, the
  // content_item is born with asset_state='pending'. The Railway
  // asset-worker produces the visuals out-of-band and flips to
  // 'ready' (all kinds done) or 'partial' (some kinds done).
  //
  // We REFUSE to publish a row that's still pending/producing — a
  // half-rendered chart card going out as the FB hero would be worse
  // than waiting one more cron cycle. 'partial' is acceptable; some
  // assets are better than none. 'failed' falls through to publish
  // text-only (the operator sees the failure in the audit log).
  const assetState = content.asset_state ?? 'none'
  if (assetState === 'pending' || assetState === 'producing') {
    return {
      ok: false, attempt_id: '',
      error: `asset_state=${assetState} — Railway asset-worker hasn't produced visuals yet. Re-queue when ready.`,
    }
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

  // Hero precedence:
  //   1. explicit sched.hero_image_url (operator override on the
  //      scheduled_posts row, e.g. for A/B testing)
  //   2. asset_urls.signal_card / trade_result_card / weekly_stats_card
  //      (per-kind asset produced by the Railway worker)
  //   3. content.hero_image_url (manually attached at draft time)
  //
  // The kind-specific lookup means a signal post automatically picks
  // up the signal_card the worker produced for THIS row, without the
  // operator having to wire URLs manually.
  const assetUrls = (content.asset_urls ?? {}) as Record<string, string>
  const kindHero =
    assetUrls[`${content.kind}_card`] ??
    assetUrls['signal_card'] ??
    assetUrls['trade_result_card'] ??
    assetUrls['weekly_stats_card'] ??
    null
  const heroUrl = sched.hero_image_url ?? kindHero ?? content.hero_image_url ?? null
  // Pick produced media from asset_urls: a video (mp4, non-thumbnail) and an
  // image (card hero, else any image asset). The adapters attach these so a
  // post carries the worker's rendered visual, not just text.
  const videoUrl = Object.entries(assetUrls)
    .find(([k, v]) => /\.mp4(\?|$)/i.test(v) && !k.endsWith('_thumbnail'))?.[1] ?? null
  const imageUrl = heroUrl
    ?? Object.entries(assetUrls).find(([, v]) => /\.(png|jpe?g|webp)(\?|$)/i.test(v))?.[1]
    ?? null
  const adapter   = await postViaAdapter(
    sched.channel as Channel,
    formatted.text,
    { hero: heroUrl, kind: content.kind, imageUrl, videoUrl },
  )
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
