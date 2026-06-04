/**
 * /api/admin/growth/video-smoke-test — fire one Creatomate render.
 *
 * Body (optional):
 *   { template_id?: string; modifications?: Record<string, unknown> }
 *
 * Defaults to the Creatomate public sample template/asset so the
 * operator can verify the API key + adapter wiring without needing
 * a custom template configured in their account yet.
 *
 * Admin-only. Awaits the render (≤90s) and returns the final
 * { id, status, url } so the admin can preview the result inline.
 */
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { isAdmin } from '@/lib/admin'
import { renderAndWait } from '@/lib/growth/adapters/creatomate'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 120

const schema = z.object({
  template_id:   z.string().min(8).optional(),
  modifications: z.record(z.string(), z.unknown()).optional(),
}).default({})

async function gate() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  if (!isAdmin(user.email)) return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  return { user }
}

// Public sample template + asset published by Creatomate in their
// quickstart docs. Useful as a connectivity probe — never use in
// production publishes.
const SAMPLE_TEMPLATE_ID = '90e158e3-64a6-4efb-b362-dff7321a8b47'
const SAMPLE_VIDEO_URL   = 'https://creatomate.com/files/assets/7347c3b7-e1a8-4439-96f1-f3dfc95c3d28'

export async function POST(req: Request) {
  const g = await gate()
  if ('error' in g) return g.error

  if (!process.env.CREATOMATE_API_KEY) {
    return NextResponse.json(
      { error: 'CREATOMATE_API_KEY not configured. Set it in Vercel env, then redeploy.' },
      { status: 503 },
    )
  }

  const body = await req.json().catch(() => ({}))
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input' }, { status: 422 })
  }

  const tid = parsed.data.template_id ?? SAMPLE_TEMPLATE_ID
  const mods = parsed.data.modifications ?? {
    'Video.source':  SAMPLE_VIDEO_URL,
    'Text-1.text':   'AlgoSphere Quant — video pipeline test',
    'Text-2.text':   `Smoke test\n[size 150%]${new Date().toUTCString()}[/size]`,
  }

  const result = await renderAndWait({
    templateId:    tid,
    modifications: mods,
    maxWaitMs:     90_000,
    pollIntervalMs: 4_000,
  })

  return NextResponse.json({
    fired_at: new Date().toISOString(),
    fired_by: g.user.email ?? g.user.id,
    ok:       result.ok,
    render:   result.render ?? null,
    error:    result.error,
  }, { status: result.ok ? 200 : 422 })
}
