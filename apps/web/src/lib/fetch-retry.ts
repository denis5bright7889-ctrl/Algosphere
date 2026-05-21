/**
 * fetchWithRetry — `fetch` wrapper with retry, exponential backoff,
 * and per-attempt timeout.
 *
 * Use cases:
 *   • Calls to the Railway signal-engine while it's cold-starting (503)
 *   • Calls through the MT5 bridge that briefly 502 because cloudflared
 *     hiccupped or the bridge was restarting
 *   • Anything where transient gateway errors shouldn't fail the
 *     user-facing flow on a single attempt
 *
 * Defaults (production-tuned for our infra):
 *   retries        = 3        — total of 4 attempts
 *   backoffMs      = 500      — doubles each retry (0.5s, 1s, 2s) + jitter
 *   timeoutMs      = 20_000   — per-attempt AbortController timeout
 *   retryStatuses  = [502,503,504]
 *
 * Does NOT retry on:
 *   • 4xx (caller error — retrying won't help)
 *   • 5xx other than gateway codes (likely a real bug; surface it)
 *   • Network errors that aren't AbortError (caller decides)
 *
 * AbortSignal: if the caller passes their own `signal`, we honor it
 * (e.g. user navigates away → abort propagates). We compose it with
 * our per-attempt timeout signal so either can cancel.
 */

export interface FetchWithRetryOptions extends RequestInit {
  /** Number of retry attempts in addition to the initial. Default 3. */
  retries?:       number
  /** Base backoff in ms. Doubles each retry; jitter ±150ms. Default 500. */
  backoffMs?:     number
  /** Per-attempt timeout in ms. Default 20000. */
  timeoutMs?:     number
  /** HTTP status codes that trigger a retry. Default [502,503,504]. */
  retryStatuses?: number[]
}

const DEFAULT_RETRIES    = 3
const DEFAULT_BACKOFF_MS = 500
const DEFAULT_TIMEOUT_MS = 20_000
const DEFAULT_RETRY_STATUSES = [502, 503, 504]


export async function fetchWithRetry(
  input:    string | URL,
  options:  FetchWithRetryOptions = {},
): Promise<Response> {
  const {
    retries       = DEFAULT_RETRIES,
    backoffMs     = DEFAULT_BACKOFF_MS,
    timeoutMs     = DEFAULT_TIMEOUT_MS,
    retryStatuses = DEFAULT_RETRY_STATUSES,
    signal:       externalSignal,
    ...fetchInit
  } = options

  let lastError: unknown = null

  for (let attempt = 0; attempt <= retries; attempt++) {
    // Per-attempt AbortController. If the caller supplied a signal,
    // we abort our internal controller when theirs fires so the
    // composed cancellation is correct.
    const ctrl  = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), timeoutMs)

    const onExternalAbort = () => ctrl.abort()
    if (externalSignal) {
      if (externalSignal.aborted) ctrl.abort()
      else externalSignal.addEventListener('abort', onExternalAbort, { once: true })
    }

    try {
      const res = await fetch(input, { ...fetchInit, signal: ctrl.signal })
      clearTimeout(timer)
      externalSignal?.removeEventListener('abort', onExternalAbort)

      if (!retryStatuses.includes(res.status)) {
        return res
      }
      // Retryable status — capture for the final throw if we exhaust.
      lastError = new RetryableHttpError(res.status, input.toString())
    } catch (err) {
      clearTimeout(timer)
      externalSignal?.removeEventListener('abort', onExternalAbort)
      // Caller cancellation — don't retry. Surface immediately.
      if (externalSignal?.aborted) throw err
      lastError = err
    }

    if (attempt < retries) {
      const jitter  = Math.floor(Math.random() * 300) - 150
      const delayMs = Math.max(0, backoffMs * Math.pow(2, attempt) + jitter)
      await new Promise(resolve => setTimeout(resolve, delayMs))
    }
  }

  if (lastError instanceof Error) throw lastError
  throw new Error(`fetchWithRetry: exhausted ${retries + 1} attempts to ${input.toString()}`)
}


/**
 * Distinguishable error for "the response came back with a retryable
 * status code on every attempt." Lets callers branch on it (e.g. show
 * a "service still cold-starting, retry" toast instead of a generic
 * network error).
 */
export class RetryableHttpError extends Error {
  readonly status: number
  readonly url:    string
  constructor(status: number, url: string) {
    super(`HTTP ${status} from ${url} (exhausted retries)`)
    this.name   = 'RetryableHttpError'
    this.status = status
    this.url    = url
  }
}
