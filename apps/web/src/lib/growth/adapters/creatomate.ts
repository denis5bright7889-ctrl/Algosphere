/**
 * Creatomate video render adapter — Phase 4E.
 *
 * Creatomate is template-based: you compose the scene once in their
 * editor (Video, Text-1, Text-2, etc. as named fields), then call
 * /v2/renders with { template_id, modifications: { fieldName: value } }
 * to produce a one-off video.
 *
 * Env required:
 *   CREATOMATE_API_KEY                — secret bearer token
 *   CREATOMATE_TEMPLATE_SIGNAL_CARD   — template id for signal videos
 *   CREATOMATE_TEMPLATE_WEEKLY_RECAP  — template id for weekly recaps
 *   CREATOMATE_TEMPLATE_BACKTEST      — template id for backtest breakdowns
 *
 * Each template id is provisioned in the Creatomate dashboard and
 * exported to env separately — we never hardcode template ids in
 * source. The shape of `modifications` is template-specific; the
 * caller passes whatever fields that template declares.
 *
 * Renders are async — POST /v2/renders returns immediately with an
 * id + status='planned'. Caller polls /v2/renders/{id} until
 * status='succeeded' (url is now valid) or 'failed' (error explains).
 * Median render time for a 30s short = ~25s, p95 ~70s.
 */

export interface CreatomateRender {
  id:       string
  status:   'planned' | 'waiting' | 'transcribing' | 'rendering' | 'succeeded' | 'failed'
  url?:     string                    // populated when status='succeeded'
  snapshot_url?: string               // poster frame
  template_id?: string
  duration?: number                   // seconds, populated on success
  width?:    number
  height?:   number
  error?:    string
}

export interface RenderResult {
  ok:       boolean
  render?:  CreatomateRender
  error?:   string
}

const API = 'https://api.creatomate.com/v2/renders'

function key(): string | null {
  return process.env.CREATOMATE_API_KEY ?? null
}

/**
 * Fire one render. Returns the planned-state row; poll getRender()
 * with the returned id until status === 'succeeded' (use url) or
 * 'failed' (use error).
 */
export async function createRender(opts: {
  templateId:    string
  modifications: Record<string, unknown>
  /** Optional webhook for completion ping. */
  webhookUrl?:   string
}): Promise<RenderResult> {
  const k = key()
  if (!k) return { ok: false, error: 'CREATOMATE_API_KEY not configured' }
  if (!opts.templateId) return { ok: false, error: 'templateId required' }

  try {
    const res = await fetch(API, {
      method:  'POST',
      headers: {
        'Authorization': `Bearer ${k}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        template_id:   opts.templateId,
        modifications: opts.modifications,
        webhook_url:   opts.webhookUrl,
      }),
    })
    const json = (await res.json().catch(() => null)) as
      | CreatomateRender
      | CreatomateRender[]      // some Creatomate API versions return an array
      | { error?: string }
      | null

    if (!res.ok) {
      const err = (json && typeof json === 'object' && !Array.isArray(json) && 'error' in json)
        ? (json as { error?: string }).error
        : null
      return { ok: false, error: err ?? `Creatomate HTTP ${res.status}` }
    }
    const render = Array.isArray(json) ? json[0] : (json as CreatomateRender | null)
    if (!render?.id) return { ok: false, error: 'Creatomate returned no render id' }
    return { ok: true, render }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'unknown' }
  }
}

/**
 * Read render status. Use for polling until succeeded / failed.
 */
export async function getRender(id: string): Promise<RenderResult> {
  const k = key()
  if (!k) return { ok: false, error: 'CREATOMATE_API_KEY not configured' }
  try {
    const res = await fetch(`${API}/${id}`, {
      method:  'GET',
      headers: { 'Authorization': `Bearer ${k}` },
    })
    const json = (await res.json().catch(() => null)) as
      | CreatomateRender
      | { error?: string }
      | null
    if (!res.ok) {
      const err = (json && typeof json === 'object' && 'error' in json)
        ? (json as { error?: string }).error
        : null
      return { ok: false, error: err ?? `Creatomate HTTP ${res.status}` }
    }
    return { ok: true, render: json as CreatomateRender }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'unknown' }
  }
}

/**
 * Convenience: poll-until-finished. Returns the final render or an
 * error. Caps at maxWaitMs to avoid hanging cron / API routes.
 *
 * Default: 90s with 5s intervals (covers p95 render time for short
 * 1080×1920 videos).
 */
export async function renderAndWait(opts: Parameters<typeof createRender>[0] & {
  maxWaitMs?:    number
  pollIntervalMs?: number
}): Promise<RenderResult> {
  const start = Date.now()
  const maxWait = opts.maxWaitMs    ?? 90_000
  const poll    = opts.pollIntervalMs ?? 5_000

  const created = await createRender(opts)
  if (!created.ok || !created.render?.id) return created

  let current = created.render
  while (current.status !== 'succeeded' && current.status !== 'failed') {
    if (Date.now() - start > maxWait) {
      return {
        ok: false,
        render: current,
        error: `Creatomate timed out after ${Math.round((Date.now() - start) / 1000)}s — render still ${current.status}. Poll /v2/renders/${current.id} manually.`,
      }
    }
    await new Promise(r => setTimeout(r, poll))
    const next = await getRender(current.id)
    if (!next.ok || !next.render) return next
    current = next.render
  }

  if (current.status === 'failed') {
    return { ok: false, render: current, error: current.error ?? 'render failed' }
  }
  return { ok: true, render: current }
}

/**
 * Template name → template id resolver. Returns null when env var
 * for that template hasn't been set yet, so callers can short-circuit
 * with a clear "template not configured" error instead of a generic
 * 422 from the API.
 */
export type CreatomateTemplate =
  | 'signal_card'
  | 'weekly_recap'
  | 'backtest_breakdown'

export function templateId(name: CreatomateTemplate): string | null {
  switch (name) {
    case 'signal_card':        return process.env.CREATOMATE_TEMPLATE_SIGNAL_CARD       ?? null
    case 'weekly_recap':       return process.env.CREATOMATE_TEMPLATE_WEEKLY_RECAP      ?? null
    case 'backtest_breakdown': return process.env.CREATOMATE_TEMPLATE_BACKTEST          ?? null
  }
}
