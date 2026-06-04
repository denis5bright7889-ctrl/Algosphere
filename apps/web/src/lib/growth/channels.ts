/**
 * Growth Engine — channel formatters.
 *
 * Pure functions. Take a content_item + optional brand settings,
 * return the channel-shaped string + any constraints (char limits,
 * thread chunks) the publisher needs to honour.
 *
 * Channel coverage matches the spec: X, Telegram, Discord, LinkedIn,
 * Instagram, Facebook, YouTube, WhatsApp channel, IG Reels, YT Shorts.
 *
 * Output shape:
 *   - text: ready-to-publish string (markdown / plain / per channel)
 *   - chunks: only set when the medium needs splitting (X threads)
 *   - hashtags: derived from tags + brand setting
 *
 * No HTTP calls here — actually publishing lives in the channel
 * adapters (lib/growth/adapters/*.ts).
 */

export type Channel =
  | 'x' | 'telegram' | 'discord' | 'linkedin'
  | 'instagram' | 'facebook' | 'youtube'
  | 'whatsapp_channel' | 'instagram_reels' | 'youtube_shorts'
  | 'tiktok'

export interface ContentInput {
  title:        string
  summary:      string | null
  body_md:      string
  tags:         string[]
  is_synthetic: boolean
  disclaimer:   string | null
  cta_text:     string | null
  cta_url:      string | null
}

export interface BrandInput {
  signature?:       string
  default_cta?:     string
  default_cta_url?: string
  legal_footer?:    string
  social?:          Record<string, string>
}

export interface FormattedPost {
  channel:  Channel
  text:     string
  /** Set for X threads — each chunk is one tweet. */
  chunks?:  string[]
  hashtags: string[]
  /** Anything the medium can't render (e.g. inline links, full
   *  markdown). Surfaced in the UI so the operator can decide. */
  warnings: string[]
}

const CHANNEL_LIMITS: Record<Channel, number | null> = {
  x:                280,
  telegram:         4096,
  discord:          2000,
  linkedin:         3000,
  instagram:        2200,
  facebook:         5000,
  youtube:          5000,
  whatsapp_channel: 4096,
  instagram_reels:  2200,
  youtube_shorts:   5000,
  tiktok:           150,   // caption only; video required
}

// ─── Channel-agnostic helpers ──────────────────────────────────────

function deriveHashtags(tags: string[], maxTags = 5): string[] {
  return tags
    .filter(Boolean)
    .slice(0, maxTags)
    .map((t) => '#' + t.replace(/[^a-zA-Z0-9_]/g, '').slice(0, 30))
    .filter((t) => t.length > 1)
}

function ctaLine(c: ContentInput, b: BrandInput): string {
  const text = c.cta_text || b.default_cta || 'Open AlgoSphere'
  const url  = c.cta_url  || b.default_cta_url || 'https://algospherequant.com'
  return `${text} → ${url}`
}

function stripMd(md: string): string {
  // Defensive: keep callouts/quotes line-cleaned, drop heading hashes,
  // drop bold/italic markers, normalise list markers, drop link
  // syntax. Cheap; no markdown parser dependency.
  return md
    .replace(/^>\s?/gm, '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/__(.*?)__/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/_(.*?)_/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)]\(([^)]+)\)/g, '$1 ($2)')
    .replace(/^- /gm, '• ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function truncate(s: string, limit: number, suffix = '…'): string {
  if (s.length <= limit) return s
  return s.slice(0, Math.max(0, limit - suffix.length)).trimEnd() + suffix
}

function syntheticTag(c: ContentInput): string {
  return c.is_synthetic ? '[Backtest result] ' : ''
}

function complianceFooter(c: ContentInput, b: BrandInput): string {
  const parts: string[] = []
  if (c.disclaimer)   parts.push(c.disclaimer)
  if (b.legal_footer) parts.push(b.legal_footer)
  return parts.join(' ')
}


// ─── X (Twitter) — thread chunker ──────────────────────────────────

export function formatForX(c: ContentInput, b: BrandInput = {}): FormattedPost {
  const tags = deriveHashtags(c.tags, 3)
  const tagSuffix = tags.length > 0 ? '\n' + tags.join(' ') : ''
  const body = stripMd(c.body_md)
  const headline = syntheticTag(c) + c.title
  const cta = ctaLine(c, b)
  const footer = complianceFooter(c, b)

  // Build the thread. Tweet 1 = headline + summary. Subsequent tweets
  // chunk the body into 270-char pieces with thread index suffixes.
  const intro = truncate(`${headline}\n\n${c.summary ?? ''}`.trim(), 250)
  const bodyChunks: string[] = []
  let remaining = body
  while (remaining.length > 0) {
    const piece = truncate(remaining, 250, '…')
    bodyChunks.push(piece)
    remaining = remaining.slice(piece.length).trim()
  }
  const closing = truncate(`${cta}${footer ? '\n\n' + footer : ''}${tagSuffix}`, 280)

  const chunks = [
    intro,
    ...bodyChunks,
    closing,
  ].map((p, i, arr) => `${p}\n\n${i + 1}/${arr.length}`)

  return {
    channel: 'x',
    text: chunks.join('\n\n---\n\n'),
    chunks,
    hashtags: tags,
    warnings: bodyChunks.length > 8
      ? ['Thread is longer than 10 tweets — consider trimming.']
      : [],
  }
}


// ─── Telegram — full markdown supported ───────────────────────────

export function formatForTelegram(c: ContentInput, b: BrandInput = {}): FormattedPost {
  const tags = deriveHashtags(c.tags, 5)
  const tagSuffix = tags.length > 0 ? '\n\n' + tags.join(' ') : ''
  const cta = ctaLine(c, b)
  const footer = complianceFooter(c, b)

  const text = [
    syntheticTag(c) + '*' + c.title + '*',
    '',
    c.body_md,
    '',
    cta,
    footer ? '\n_' + footer + '_' : '',
    b.signature ?? '',
    tagSuffix,
  ].filter((line) => line !== undefined && line !== null).join('\n')

  return {
    channel: 'telegram',
    text: truncate(text.trim(), CHANNEL_LIMITS.telegram!),
    hashtags: tags,
    warnings: [],
  }
}


// ─── Discord — embed-friendly markdown, 2000 char hard cap ────────

export function formatForDiscord(c: ContentInput, b: BrandInput = {}): FormattedPost {
  const tags = deriveHashtags(c.tags, 3)
  const cta = ctaLine(c, b)
  const footer = complianceFooter(c, b)

  const text = truncate(
    [
      syntheticTag(c) + '**' + c.title + '**',
      '',
      c.body_md,
      '',
      '→ ' + cta,
      footer ? '\n*' + footer + '*' : '',
    ].filter(Boolean).join('\n'),
    CHANNEL_LIMITS.discord!,
  )

  return {
    channel: 'discord',
    text,
    hashtags: tags,
    warnings: text.length === CHANNEL_LIMITS.discord!
      ? ['Body truncated to Discord 2 000-char limit.']
      : [],
  }
}


// ─── LinkedIn — long-form, no markdown formatting respected ───────

export function formatForLinkedIn(c: ContentInput, b: BrandInput = {}): FormattedPost {
  const tags = deriveHashtags(c.tags, 5)
  const tagSuffix = tags.length > 0 ? '\n\n' + tags.join(' ') : ''
  const cta = ctaLine(c, b)
  const footer = complianceFooter(c, b)
  const body = stripMd(c.body_md)

  const text = truncate(
    [
      syntheticTag(c) + c.title,
      '',
      c.summary ?? '',
      '',
      body,
      '',
      '→ ' + cta,
      footer ? '\n— ' + footer : '',
      b.signature ?? '',
      tagSuffix,
    ].filter(Boolean).join('\n'),
    CHANNEL_LIMITS.linkedin!,
  )

  return {
    channel: 'linkedin',
    text,
    hashtags: tags,
    warnings: [],
  }
}


// ─── Instagram (caption-style) ────────────────────────────────────

export function formatForInstagram(c: ContentInput, b: BrandInput = {}): FormattedPost {
  const tags = deriveHashtags(c.tags, 10) // IG tolerates more tags
  const tagSuffix = tags.length > 0 ? '\n\n.\n.\n.\n' + tags.join(' ') : ''
  const cta = ctaLine(c, b)
  const footer = complianceFooter(c, b)
  const body = stripMd(c.body_md)

  const text = truncate(
    [
      syntheticTag(c) + c.title,
      '',
      c.summary ?? '',
      '',
      truncate(body, 1500),
      '',
      cta,
      footer ? '\n' + footer : '',
      tagSuffix,
    ].filter(Boolean).join('\n'),
    CHANNEL_LIMITS.instagram!,
  )

  return {
    channel: 'instagram',
    text,
    hashtags: tags,
    warnings: ['Instagram requires a hero image — set hero_image_url on the content item.'],
  }
}


// ─── Generic adapter for the catch-all channels (FB / YT / WA /
//     reels / shorts). Same body envelope as LinkedIn, channel-tagged.
function genericLongForm(channel: Channel, c: ContentInput, b: BrandInput): FormattedPost {
  const lk = formatForLinkedIn(c, b)
  return { ...lk, channel }
}

export function formatForChannel(channel: Channel, c: ContentInput, b: BrandInput = {}): FormattedPost {
  switch (channel) {
    case 'x':                return formatForX(c, b)
    case 'telegram':         return formatForTelegram(c, b)
    case 'discord':          return formatForDiscord(c, b)
    case 'linkedin':         return formatForLinkedIn(c, b)
    case 'instagram':        return formatForInstagram(c, b)
    case 'facebook':
    case 'youtube':
    case 'whatsapp_channel':
    case 'instagram_reels':
    case 'youtube_shorts':
    case 'tiktok':
      return genericLongForm(channel, c, b)
  }
}

export const SUPPORTED_CHANNELS: { key: Channel; label: string; wired: boolean }[] = [
  { key: 'telegram',         label: 'Telegram',          wired: true  },
  { key: 'discord',          label: 'Discord',           wired: true  },
  { key: 'linkedin',         label: 'LinkedIn',          wired: true  }, // env-gated
  { key: 'facebook',         label: 'Facebook',          wired: true  }, // env-gated
  { key: 'instagram',        label: 'Instagram',         wired: true  }, // env-gated, needs hero
  { key: 'x',                label: 'X (Twitter)',       wired: false }, // needs SDK install
  { key: 'whatsapp_channel', label: 'WhatsApp Channel',  wired: false }, // no public API
  { key: 'instagram_reels',  label: 'Instagram Reels',   wired: false }, // video pipeline
  { key: 'youtube',          label: 'YouTube',           wired: false }, // video pipeline
  { key: 'youtube_shorts',   label: 'YouTube Shorts',    wired: false }, // video pipeline
]
