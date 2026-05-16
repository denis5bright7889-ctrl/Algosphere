/**
 * Tauri 2 updater endpoint.
 *
 * The desktop app polls:
 *   GET /api/desktop/update/{target}/{current_version}
 * where {target} is e.g. "windows-x86_64", "darwin-aarch64", "linux-x86_64".
 *
 * Contract (Tauri v2 dynamic-endpoint):
 *   • 204 No Content  → client is up to date (or no release published)
 *   • 200 + JSON      → an update is available:
 *       { version, notes, pub_date, url, signature }
 *
 * Releases are published as a static manifest committed to
 * apps/web/public/releases/desktop.json — no DB, no extra infra. Shape:
 *
 *   {
 *     "version": "0.2.0",
 *     "notes": "…",
 *     "pub_date": "2026-06-01T00:00:00Z",
 *     "platforms": {
 *       "windows-x86_64": { "url": "https://…/AlgoSphere_0.2.0_x64.msi.zip",
 *                            "signature": "<minisign sig from `tauri build`>" },
 *       "darwin-aarch64": { "url": "…", "signature": "…" },
 *       "linux-x86_64":   { "url": "…", "signature": "…" }
 *     }
 *   }
 *
 * Until that file exists every poll correctly returns 204, so shipping
 * this route is safe even before the first desktop release.
 */
import { NextRequest, NextResponse } from 'next/server'

interface Manifest {
  version:  string
  notes?:   string
  pub_date?: string
  platforms: Record<string, { url: string; signature: string }>
}

// Newer-than compare for plain semver (x.y.z). Pre-release tags are
// treated as older than their release — fine for our linear cadence.
function isNewer(candidate: string, current: string): boolean {
  const norm = (v: string) =>
    (v.replace(/^v/, '').split('-')[0] ?? '0').split('.').map(n => parseInt(n, 10) || 0)
  const a = norm(candidate)
  const b = norm(current)
  for (let i = 0; i < 3; i++) {
    const ai = a[i] ?? 0
    const bi = b[i] ?? 0
    if (ai > bi) return true
    if (ai < bi) return false
  }
  return false
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ target: string; version: string }> },
) {
  const { target, version } = await ctx.params

  // Read the static manifest off our own origin (works on Vercel edge/CDN).
  const origin = req.nextUrl.origin
  let manifest: Manifest
  try {
    const res = await fetch(`${origin}/releases/desktop.json`, {
      // Cache a few minutes — release cadence is slow, polls are frequent.
      next: { revalidate: 300 },
    })
    if (!res.ok) return new NextResponse(null, { status: 204 })
    manifest = (await res.json()) as Manifest
  } catch {
    return new NextResponse(null, { status: 204 })
  }

  const platform = manifest.platforms?.[target]
  if (!platform || !manifest.version || !isNewer(manifest.version, version)) {
    return new NextResponse(null, { status: 204 })
  }

  return NextResponse.json({
    version:   manifest.version,
    notes:     manifest.notes ?? `AlgoSphere Quant ${manifest.version}`,
    pub_date:  manifest.pub_date ?? new Date().toISOString(),
    url:       platform.url,
    signature: platform.signature,
  })
}
