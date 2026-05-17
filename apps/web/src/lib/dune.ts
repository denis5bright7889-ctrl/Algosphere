/**
 * Dune Analytics API client — server-only.
 *
 * The API key MUST stay server-side (env: DUNE_API_KEY). Import only
 * from API routes and server components.
 *
 * Two paths cover the common cases:
 *
 *   getLatestResults(queryId, params?)
 *     Cheapest. Returns the most recent CACHED results for the query
 *     (auto-refreshed by the query's own schedule on dune.com). No
 *     credits spent, fast. Use this for any read-mostly surface.
 *
 *   executeAndWait(queryId, params?, opts?)
 *     Full lifecycle: POST /execute → poll /status until COMPLETED →
 *     GET /results. Spends a credit per execution. Use this when you
 *     genuinely need a fresh run (rare).
 *
 * Both return a normalised { rows, columns, executedAt } envelope so
 * consumers don't have to care which path was used.
 */

const BASE = 'https://api.dune.com/api/v1'

export type DuneRow = Record<string, unknown>

export interface DuneResults<T extends DuneRow = DuneRow> {
  rows:        T[]
  /** Column names in the order Dune returned them. */
  columns:     string[]
  /** Timestamp of the underlying execution (ISO string), if known. */
  executedAt:  string | null
  /** Source path — useful when debugging which lifecycle ran. */
  source:      'latest' | 'executed'
  raw?:        unknown
}

export type ExecutionState =
  | 'QUERY_STATE_PENDING'
  | 'QUERY_STATE_EXECUTING'
  | 'QUERY_STATE_FAILED'
  | 'QUERY_STATE_COMPLETED'
  | 'QUERY_STATE_CANCELLED'
  | 'QUERY_STATE_EXPIRED'

export class DuneError extends Error {
  constructor(message: string, public readonly code: string, public readonly status?: number) {
    super(message)
  }
}

export function isDuneConfigured(): boolean {
  return typeof process.env.DUNE_API_KEY === 'string' && process.env.DUNE_API_KEY.length > 8
}

function headers(): Record<string, string> {
  const key = process.env.DUNE_API_KEY
  if (!key) throw new DuneError('DUNE_API_KEY not configured', 'no_key')
  return { 'Content-Type': 'application/json', 'X-Dune-API-Key': key }
}

interface RawResults {
  execution_id?:      string
  query_id?:          number
  is_execution_finished?: boolean
  state?:             ExecutionState
  submitted_at?:      string
  expires_at?:        string
  execution_started_at?: string
  execution_ended_at?: string
  result?: {
    rows:     DuneRow[]
    metadata?: {
      column_names?: string[]
      result_set_bytes?: number
      total_row_count?:  number
      datapoint_count?:  number
      pending_time_millis?:   number
      execution_time_millis?: number
    }
  }
}

function normalise(raw: RawResults, source: 'latest' | 'executed'): DuneResults {
  const rows    = raw.result?.rows ?? []
  const columns = raw.result?.metadata?.column_names ?? (rows[0] ? Object.keys(rows[0]) : [])
  return {
    rows,
    columns,
    executedAt: raw.execution_ended_at ?? raw.submitted_at ?? null,
    source,
    raw,
  }
}

/** Build the param payload Dune expects: { query_parameters: { name: value, ... } }. */
function paramBody(parameters?: Record<string, string | number | boolean>) {
  if (!parameters) return undefined
  const query_parameters: Record<string, string> = {}
  for (const [k, v] of Object.entries(parameters)) query_parameters[k] = String(v)
  return { query_parameters }
}

/**
 * Cheapest path — fetch the LATEST cached results for a query. No
 * execution credit spent. Refresh cadence is controlled on dune.com
 * (query schedule).
 */
export async function getLatestResults<T extends DuneRow = DuneRow>(
  queryId: number,
  parameters?: Record<string, string | number | boolean>,
  opts: { limit?: number; offset?: number } = {},
): Promise<DuneResults<T>> {
  const url = new URL(`${BASE}/query/${queryId}/results`)
  if (opts.limit  != null) url.searchParams.set('limit',  String(opts.limit))
  if (opts.offset != null) url.searchParams.set('offset', String(opts.offset))
  if (parameters) {
    for (const [k, v] of Object.entries(parameters)) {
      url.searchParams.set(`params.${k}`, String(v))
    }
  }

  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), 20_000)
  try {
    const res = await fetch(url.toString(), {
      method:  'GET',
      headers: headers(),
      signal:  ctl.signal,
      // Cache identical requests at the runtime layer for a minute.
      next: { revalidate: 60 },
    })
    if (!res.ok) {
      throw new DuneError(`Dune ${res.status}: ${(await res.text().catch(() => '')).slice(0, 220)}`, 'http_error', res.status)
    }
    const raw = await res.json() as RawResults
    return normalise(raw, 'latest') as DuneResults<T>
  } catch (e) {
    if (e instanceof DuneError) throw e
    if ((e as Error)?.name === 'AbortError') throw new DuneError('Dune request timed out', 'timeout')
    throw new DuneError((e as Error)?.message ?? 'Dune request failed', 'fetch_error')
  } finally {
    clearTimeout(t)
  }
}

/**
 * Full execute → poll → fetch. Use only when fresh data is genuinely
 * required (spends one Dune credit per call).
 */
export async function executeAndWait<T extends DuneRow = DuneRow>(
  queryId: number,
  parameters?: Record<string, string | number | boolean>,
  opts: {
    performance?: 'medium' | 'large'
    /** Max ms to wait for completion. Default 45_000. */
    timeoutMs?:   number
    /** Poll interval ms. Default 1500. */
    pollMs?:      number
  } = {},
): Promise<DuneResults<T>> {
  const timeoutMs = opts.timeoutMs ?? 45_000
  const pollMs    = opts.pollMs    ?? 1500

  // 1) Submit execution
  const exec = await fetch(`${BASE}/query/${queryId}/execute`, {
    method:  'POST',
    headers: headers(),
    body:    JSON.stringify({
      ...paramBody(parameters),
      ...(opts.performance ? { performance: opts.performance } : {}),
    }),
    cache: 'no-store',
  })
  if (!exec.ok) {
    throw new DuneError(`Dune execute ${exec.status}: ${(await exec.text().catch(() => '')).slice(0, 220)}`, 'execute_failed', exec.status)
  }
  const { execution_id } = await exec.json() as { execution_id: string }
  if (!execution_id) throw new DuneError('Dune did not return execution_id', 'execute_failed')

  // 2) Poll status
  const deadline = Date.now() + timeoutMs
  let lastState: ExecutionState | undefined
  while (Date.now() < deadline) {
    const st = await fetch(`${BASE}/execution/${execution_id}/status`, { headers: headers(), cache: 'no-store' })
    if (!st.ok) throw new DuneError(`Dune status ${st.status}`, 'status_failed', st.status)
    const j = await st.json() as { state: ExecutionState; is_execution_finished?: boolean }
    lastState = j.state
    if (j.is_execution_finished || j.state === 'QUERY_STATE_COMPLETED') break
    if (j.state === 'QUERY_STATE_FAILED' || j.state === 'QUERY_STATE_CANCELLED' || j.state === 'QUERY_STATE_EXPIRED') {
      throw new DuneError(`Dune execution ended: ${j.state}`, 'execute_failed')
    }
    await new Promise((r) => setTimeout(r, pollMs))
  }
  if (lastState !== 'QUERY_STATE_COMPLETED') {
    throw new DuneError(`Dune execution did not complete within ${timeoutMs}ms (last state: ${lastState ?? 'unknown'})`, 'timeout')
  }

  // 3) Fetch results
  const r = await fetch(`${BASE}/execution/${execution_id}/results`, { headers: headers(), cache: 'no-store' })
  if (!r.ok) throw new DuneError(`Dune results ${r.status}`, 'results_failed', r.status)
  const raw = await r.json() as RawResults
  return normalise(raw, 'executed') as DuneResults<T>
}
