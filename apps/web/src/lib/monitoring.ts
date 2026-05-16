/**
 * AlgoSphere Quant — Lightweight error reporting.
 *
 * Zero-dependency stub that's Sentry-compatible: when SENTRY_DSN is set,
 * errors POST directly to Sentry's HTTP store endpoint. Otherwise no-ops.
 *
 * Why not the @sentry/* SDK? The Sentry SDK is ~500KB and noisy to wire
 * across both server + edge + client. Direct HTTP keeps the bundle clean
 * and lets us add structured tags without ceremony. Swap in the official
 * SDK later if you need session replay / source-maps / performance.
 */

const DSN = process.env.SENTRY_DSN
const ENVIRONMENT = process.env.NEXT_PUBLIC_VERCEL_ENV
                 ?? process.env.NODE_ENV
                 ?? 'development'
const RELEASE = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? 'local'

interface ParsedDsn {
  protocol:   string
  publicKey:  string
  host:       string
  projectId:  string
}

let _parsed: ParsedDsn | null | undefined

function parseDsn(): ParsedDsn | null {
  if (_parsed !== undefined) return _parsed
  if (!DSN) return (_parsed = null)
  try {
    const u = new URL(DSN)
    _parsed = {
      protocol:  u.protocol.replace(':', ''),
      publicKey: u.username,
      host:      u.host,
      projectId: u.pathname.replace(/^\//, ''),
    }
    return _parsed
  } catch {
    return (_parsed = null)
  }
}

export function isMonitoringEnabled(): boolean {
  return parseDsn() !== null
}

interface ReportContext {
  tags?:    Record<string, string>
  extra?:   Record<string, unknown>
  user_id?: string
  request_id?: string
}

/**
 * Fire-and-forget error report. Always returns void. Never throws.
 */
export function reportError(err: unknown, ctx: ReportContext = {}): void {
  const dsn = parseDsn()
  if (!dsn) {
    // In dev, still log to console with structured prefix
    if (ENVIRONMENT !== 'production') {
      console.error('[monitor]', err, ctx)
    }
    return
  }

  const e = err instanceof Error ? err : new Error(String(err))

  const payload = {
    event_id:    crypto.randomUUID().replace(/-/g, ''),
    timestamp:   new Date().toISOString(),
    platform:    'javascript',
    level:       'error',
    environment: ENVIRONMENT,
    release:     RELEASE,
    server_name: process.env.VERCEL_REGION ?? 'unknown',
    exception: {
      values: [{
        type:  e.name,
        value: e.message,
        stacktrace: e.stack ? {
          frames: parseStack(e.stack).slice(-15),  // last 15 frames is enough
        } : undefined,
      }],
    },
    tags:  ctx.tags,
    extra: ctx.extra,
    user:  ctx.user_id ? { id: ctx.user_id } : undefined,
  }

  const url = `https://${dsn.host}/api/${dsn.projectId}/store/`
  const auth = [
    'Sentry sentry_version=7',
    `sentry_key=${dsn.publicKey}`,
    'sentry_client=algosphere/1.0',
  ].join(', ')

  fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Sentry-Auth': auth,
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(3_000),
  }).catch(() => { /* never let monitoring failure cascade */ })
}

function parseStack(stack: string): Array<{ filename: string; function: string; lineno: number }> {
  return stack.split('\n')
    .map(line => {
      // V8 format: "    at funcName (file:line:col)"
      const m = line.match(/at\s+(.+?)\s+\((.+?):(\d+):\d+\)/)
            ?? line.match(/at\s+(.+?):(\d+):\d+/)
      if (!m) return null
      if (m.length === 4) {
        return { function: m[1]!, filename: m[2]!, lineno: parseInt(m[3]!, 10) }
      }
      return { function: '<anonymous>', filename: m[1]!, lineno: parseInt(m[2]!, 10) }
    })
    .filter((x): x is { filename: string; function: string; lineno: number } => x !== null)
}

/**
 * Wrap an async function to auto-report exceptions.
 *   const safeRun = withMonitoring(runJob, { tags: { job: 'settle' } })
 */
export function withMonitoring<A extends unknown[], R>(
  fn: (...a: A) => Promise<R>,
  ctx: ReportContext = {},
): (...a: A) => Promise<R> {
  return async (...args: A) => {
    try {
      return await fn(...args)
    } catch (err) {
      reportError(err, ctx)
      throw err
    }
  }
}
