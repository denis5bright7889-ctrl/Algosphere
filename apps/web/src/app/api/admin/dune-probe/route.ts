/**
 * POST /api/admin/dune-probe
 *
 * Admin-only inspector for Dune queries. Lets you exercise the
 * client end-to-end without building a real user-facing surface.
 *
 * Body:
 *   {
 *     "query_id":   12345678,
 *     "mode":       "latest" | "execute",   // default "latest"
 *     "parameters": { "name": "value", ... }?,
 *     "limit":      100?,                   // latest mode only
 *     "offset":     0?,                     // latest mode only
 *     "performance": "medium" | "large"?    // execute mode only
 *   }
 *
 * Returns: { rows: [], columns: [], executedAt, source, took_ms }
 *
 * 'latest' is cheap (cached results, no Dune credit). Use 'execute'
 * only when you need a fresh run.
 */
import { createClient } from '@/lib/supabase/server'
import { isAdmin } from '@/lib/admin'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import {
  getLatestResults, executeAndWait, isDuneConfigured, DuneError,
} from '@/lib/dune'

const schema = z.object({
  query_id:    z.number().int().positive(),
  mode:        z.enum(['latest', 'execute']).default('latest'),
  parameters:  z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
  limit:       z.number().int().min(1).max(10_000).optional(),
  offset:      z.number().int().min(0).optional(),
  performance: z.enum(['medium', 'large']).optional(),
})

export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !isAdmin(user.email)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (!isDuneConfigured()) {
    return NextResponse.json({ error: 'DUNE_API_KEY not configured' }, { status: 503 })
  }

  const parsed = schema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input', issues: parsed.error.flatten() }, { status: 422 })
  }
  const { query_id, mode, parameters, limit, offset, performance } = parsed.data

  const startedAt = Date.now()
  try {
    const result = mode === 'execute'
      ? await executeAndWait(query_id, parameters, { performance })
      : await getLatestResults(query_id, parameters, { limit, offset })

    return NextResponse.json({
      query_id,
      rows:        result.rows,
      columns:     result.columns,
      executedAt:  result.executedAt,
      source:      result.source,
      row_count:   result.rows.length,
      took_ms:     Date.now() - startedAt,
    })
  } catch (e) {
    const err = e instanceof DuneError ? e : new DuneError(String(e), 'unknown')
    const status = err.code === 'no_key'    ? 503
                 : err.code === 'timeout'   ? 504
                 : err.status              ?? 502
    return NextResponse.json({ error: err.message, code: err.code }, { status })
  }
}
