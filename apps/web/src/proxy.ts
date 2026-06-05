import { type NextRequest, NextResponse } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'

const VID_COOKIE    = '__as_vid'
const VID_MAX_AGE_S = 60 * 60 * 24 * 365 * 2   // 2 years

function newVisitorId(): string {
  // crypto.randomUUID is available in the edge runtime.
  return crypto.randomUUID()
}

/**
 * Attach the __as_vid first-party visitor cookie to whatever response
 * the upstream auth helper produced (or the fallback NextResponse).
 * Idempotent — only mints a new id when none is present.
 */
function attachVisitorCookie(req: NextRequest, res: NextResponse): NextResponse {
  if (req.cookies.get(VID_COOKIE)) return res
  res.cookies.set({
    name:     VID_COOKIE,
    value:    newVisitorId(),
    maxAge:   VID_MAX_AGE_S,
    path:     '/',
    sameSite: 'lax',
    secure:   process.env.NODE_ENV === 'production',
    httpOnly: false,        // client-side reads for sendBeacon attribution
  })
  return res
}

export async function proxy(request: NextRequest) {
  // ── TikTok (and similar) site-verification trailing-slash handling.
  //
  // TikTok's verifier hits /tiktok<hash>.txt/ (with the slash). With
  // skipTrailingSlashRedirect: true (next.config), Next.js no longer
  // auto-308's the trailing slash away, so we rewrite internally here.
  // Constrained to .txt/ paths so we don't accidentally rewrite app
  // routes that legitimately use trailing slashes.
  const pathname = request.nextUrl.pathname
  if (pathname.endsWith('.txt/')) {
    const url = request.nextUrl.clone()
    url.pathname = pathname.replace(/\/$/, '')
    return NextResponse.rewrite(url)
  }

  // Skip Supabase session handling if env vars are not configured yet
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    return attachVisitorCookie(request, NextResponse.next())
  }
  try {
    const res = await updateSession(request)
    return attachVisitorCookie(request, res)
  } catch {
    return attachVisitorCookie(request, NextResponse.next())
  }
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
