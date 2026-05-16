/**
 * AlgoSphere Quant — Unified AI client.
 *
 * Single source of truth for all LLM calls. Backed by Google Gemini
 * (free tier covers 1M tokens/day on flash). Swappable to any provider
 * later — only this file changes.
 *
 * Design choices:
 *  - fetch-only (no SDK) → zero extra deps, faster cold starts
 *  - Structured JSON outputs via responseMimeType
 *  - In-memory LRU cache for identical prompts within 5 min (saves quota)
 *  - Explicit timeouts, never hang the API route
 *  - Server-only — never import from a Client Component
 */

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models'

export type GeminiModel =
  | 'gemini-flash-latest'    // default — fastest, free tier
  | 'gemini-2.5-flash'       // pinned version
  | 'gemini-2.5-pro'         // higher quality, lower free quota

export class AIError extends Error {
  constructor(
    message: string,
    public code:   'no_key' | 'api_error' | 'timeout' | 'parse' | 'quota',
    public status?: number,
  ) {
    super(message)
    this.name = 'AIError'
  }
}

// ─── Tiny LRU cache (key → result, 5-min TTL) ────────────────────────
interface CacheEntry { value: string; expiresAt: number }
const CACHE = new Map<string, CacheEntry>()
const CACHE_TTL_MS = 5 * 60_000
const CACHE_MAX    = 200

function cacheGet(key: string): string | null {
  const hit = CACHE.get(key)
  if (!hit) return null
  if (hit.expiresAt < Date.now()) { CACHE.delete(key); return null }
  // touch LRU
  CACHE.delete(key); CACHE.set(key, hit)
  return hit.value
}
function cacheSet(key: string, value: string): void {
  if (CACHE.size >= CACHE_MAX) {
    const first = CACHE.keys().next().value
    if (first) CACHE.delete(first)
  }
  CACHE.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS })
}

// ─── Public API ──────────────────────────────────────────────────────

interface BaseOpts {
  model?:             GeminiModel
  systemInstruction?: string
  maxTokens?:         number
  temperature?:       number
  timeoutMs?:         number
  cache?:             boolean      // cache identical prompts (default true)
}

export async function generateText(
  opts: BaseOpts & { prompt: string },
): Promise<string> {
  const key = process.env.GEMINI_API_KEY
  if (!key) throw new AIError('GEMINI_API_KEY not configured', 'no_key')

  const model       = opts.model ?? 'gemini-flash-latest'
  const useCache    = opts.cache ?? true
  const cacheKey    = useCache
    ? `${model}|${opts.systemInstruction ?? ''}|${opts.prompt}`
    : ''
  if (useCache) {
    const hit = cacheGet(cacheKey)
    if (hit !== null) return hit
  }

  const body: Record<string, unknown> = {
    contents: [{ parts: [{ text: opts.prompt }] }],
    generationConfig: {
      maxOutputTokens: opts.maxTokens   ?? 1024,
      temperature:     opts.temperature ?? 0.4,
    },
  }
  if (opts.systemInstruction) {
    body.systemInstruction = { parts: [{ text: opts.systemInstruction }] }
  }

  const controller = new AbortController()
  const timer      = setTimeout(() => controller.abort(), opts.timeoutMs ?? 30_000)

  let res: Response
  try {
    res = await fetch(`${GEMINI_BASE}/${model}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-goog-api-key': key },
      body:    JSON.stringify(body),
      signal:  controller.signal,
    })
  } catch (e) {
    clearTimeout(timer)
    if (e instanceof Error && e.name === 'AbortError') {
      throw new AIError('AI request timed out', 'timeout')
    }
    throw new AIError(`AI fetch failed: ${e}`, 'api_error')
  }
  clearTimeout(timer)

  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    if (res.status === 429) throw new AIError('AI quota exceeded', 'quota', 429)
    throw new AIError(
      `Gemini ${res.status}: ${errText.slice(0, 200)}`,
      'api_error', res.status,
    )
  }

  const data = await res.json() as {
    candidates?: { content?: { parts?: { text?: string }[] } }[]
  }
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
  if (useCache && text) cacheSet(cacheKey, text)
  return text
}

/**
 * Generate a structured JSON object. Uses Gemini's responseMimeType for
 * guaranteed-valid JSON, then validates against the caller's runtime guard.
 */
export async function generateJSON<T>(
  opts: BaseOpts & {
    prompt:   string
    validate: (raw: unknown) => raw is T   // type guard
  },
): Promise<T> {
  const key = process.env.GEMINI_API_KEY
  if (!key) throw new AIError('GEMINI_API_KEY not configured', 'no_key')

  const model      = opts.model ?? 'gemini-flash-latest'
  const controller = new AbortController()
  const timer      = setTimeout(() => controller.abort(), opts.timeoutMs ?? 30_000)

  const body: Record<string, unknown> = {
    contents: [{ parts: [{ text: opts.prompt }] }],
    generationConfig: {
      maxOutputTokens:  opts.maxTokens   ?? 1024,
      temperature:      opts.temperature ?? 0.3,   // lower for structured
      responseMimeType: 'application/json',
    },
  }
  if (opts.systemInstruction) {
    body.systemInstruction = { parts: [{ text: opts.systemInstruction }] }
  }

  let res: Response
  try {
    res = await fetch(`${GEMINI_BASE}/${model}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-goog-api-key': key },
      body:    JSON.stringify(body),
      signal:  controller.signal,
    })
  } catch (e) {
    clearTimeout(timer)
    if (e instanceof Error && e.name === 'AbortError') {
      throw new AIError('AI request timed out', 'timeout')
    }
    throw new AIError(`AI fetch failed: ${e}`, 'api_error')
  }
  clearTimeout(timer)

  if (!res.ok) {
    if (res.status === 429) throw new AIError('AI quota exceeded', 'quota', 429)
    throw new AIError(`Gemini ${res.status}`, 'api_error', res.status)
  }

  const data = await res.json() as {
    candidates?: { content?: { parts?: { text?: string }[] } }[]
  }
  const raw = data.candidates?.[0]?.content?.parts?.[0]?.text
  if (!raw) throw new AIError('Empty AI response', 'parse')

  let parsed: unknown
  try { parsed = JSON.parse(raw) } catch {
    throw new AIError(`AI returned non-JSON: ${raw.slice(0, 100)}`, 'parse')
  }
  if (!opts.validate(parsed)) {
    throw new AIError('AI response failed schema validation', 'parse')
  }
  return parsed
}

/** True if the AI provider is configured. UI uses this to gate features. */
export function isAIAvailable(): boolean {
  return !!process.env.GEMINI_API_KEY
}
