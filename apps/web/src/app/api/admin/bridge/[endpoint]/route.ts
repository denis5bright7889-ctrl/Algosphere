import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isAdmin } from '@/lib/admin'

/**
 * Admin-only proxy from algospherequant.com → mt5.algospherequant.com.
 *
 * Why proxy at all?  The bridge requires X-Bridge-Key auth on every
 * call. If the browser called the bridge directly we'd either have to
 * expose the key in the page (security hole) or make admins paste it
 * on every visit (terrible UX). Proxying through this route keeps
 * MT5_BRIDGE_API_KEY in Vercel env-vars only — the browser never sees
 * the secret.
 *
 * Routes:
 *   GET /api/admin/bridge/health      → bridge GET /health (public, no auth needed but we proxy for CORS + uniformity)
 *   GET /api/admin/bridge/processes   → bridge GET /processes (authed)
 *   GET /api/admin/bridge/logs        → bridge GET /logs?lines=50 (authed)
 *
 * `lines` query passthrough is supported on /logs so the client can
 * request a different tail size.
 */

const ALLOWED_ENDPOINTS = new Set(['health', 'processes', 'logs'])

export async function GET(
  req: Request,
  { params }: { params: Promise<{ endpoint: string }> },
) {
  // 1. Admin gate. Anonymous + non-admin = 403 (don't leak existence).
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !isAdmin(user.email)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // 2. Validate endpoint allowlist.
  const { endpoint } = await params
  if (!ALLOWED_ENDPOINTS.has(endpoint)) {
    return NextResponse.json({ error: 'Unknown endpoint' }, { status: 404 })
  }

  // 3. Bridge URL must be configured.
  const bridgeUrl = (process.env.MT5_BRIDGE_URL ?? '').trim().replace(/\/$/, '')
  const bridgeKey = process.env.MT5_BRIDGE_API_KEY ?? ''
  if (!bridgeUrl) {
    return NextResponse.json(
      { error: 'MT5_BRIDGE_URL not configured on this Vercel deployment' },
      { status: 503 },
    )
  }

  // 4. Pass through `lines` query for /logs.
  const url = new URL(req.url)
  const linesQuery = url.searchParams.get('lines')
  const target =
    endpoint === 'logs' && linesQuery
      ? `${bridgeUrl}/${endpoint}?lines=${encodeURIComponent(linesQuery)}`
      : `${bridgeUrl}/${endpoint}`

  // 5. Forward, with short timeout. Bridge → tunnel can be slow under
  // congestion; admins prefer "degraded" over "spinner forever".
  const ctrl  = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 8_000)
  try {
    const headers: Record<string, string> = { accept: 'application/json' }
    if (bridgeKey && endpoint !== 'health') headers['X-Bridge-Key'] = bridgeKey
    const res = await fetch(target, {
      method:  'GET',
      headers,
      signal:  ctrl.signal,
      cache:   'no-store',
    })
    clearTimeout(timer)
    const text = await res.text()
    // Pass status + body verbatim so the client can surface bridge
    // errors (e.g. 503 "MT5 not ready") with their original detail.
    return new NextResponse(text, {
      status: res.status,
      headers: { 'content-type': res.headers.get('content-type') ?? 'application/json' },
    })
  } catch (e) {
    clearTimeout(timer)
    const msg = e instanceof Error
      ? (e.name === 'AbortError' ? 'bridge timeout (8s)' : e.message)
      : 'fetch failed'
    return NextResponse.json(
      { error: `bridge unreachable: ${msg}`, target },
      { status: 502 },
    )
  }
}
