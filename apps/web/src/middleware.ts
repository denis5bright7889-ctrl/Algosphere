/**
 * Next.js middleware — runs on every request that matches the
 * matcher below. Two responsibilities:
 *
 *  1. Visitor cookie (__as_vid)
 *     Sets a first-party visitor id the moment a new user lands.
 *     `/api/track/event` reads it to log funnel events; growth_visitors
 *     row is created on the first pageview.
 *
 *  2. Forward path to Server Components via x-pathname header.
 *     The App Router does not expose pathname server-side natively;
 *     the dashboard layout reads this header from `next/headers`.
 *
 * The existing supabase ssr updateSession() helper (in lib/supabase/
 * middleware.ts) is intentionally NOT re-invoked here — it forwards
 * the same x-pathname and refreshes the auth cookie, but it's only
 * been used opportunistically per-route. If you need that behavior
 * globally later, swap NextResponse.next() for `await updateSession(req)`.
 */
import { NextResponse, type NextRequest } from 'next/server'

const VID_COOKIE      = '__as_vid'
const VID_MAX_AGE_S   = 60 * 60 * 24 * 365 * 2   // 2 years

function newVisitorId(): string {
  // crypto.randomUUID is available in the edge runtime.
  return crypto.randomUUID()
}

export function middleware(req: NextRequest) {
  // Forward the path so Server Components can read it.
  const headers = new Headers(req.headers)
  headers.set('x-pathname', req.nextUrl.pathname)

  const res = NextResponse.next({ request: { headers } })

  // Mint a visitor id if not already present.
  const existing = req.cookies.get(VID_COOKIE)?.value
  if (!existing) {
    res.cookies.set({
      name:     VID_COOKIE,
      value:    newVisitorId(),
      maxAge:   VID_MAX_AGE_S,
      path:     '/',
      sameSite: 'lax',
      secure:   process.env.NODE_ENV === 'production',
      httpOnly: false,        // client-side can read for sendBeacon attribution
    })
  }

  return res
}

// Skip static assets + Next internals. We DO run on /api routes so
// /api/track/event sees the cookie consistently.
export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|opengraph-image.png|robots.txt|sitemap.xml|api/og).*)',
  ],
}
