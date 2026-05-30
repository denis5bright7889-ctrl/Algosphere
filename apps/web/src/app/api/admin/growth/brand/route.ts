/**
 * /api/admin/growth/brand — Growth Engine Phase 2 brand settings.
 *
 * Singleton row (id=1) so GET returns one record and PUT upserts the
 * same id. Admin-gated; service role used for the read+write so RLS
 * (which blocks all non-service-role access) can't trip us up.
 */
import { NextResponse } from 'next/server'
import { createClient as serviceClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { isAdmin } from '@/lib/admin'

export const dynamic = 'force-dynamic'

function svc() {
  return serviceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

async function gate() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  if (!isAdmin(user.email)) return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  return { user }
}

export async function GET() {
  const g = await gate()
  if ('error' in g) return g.error

  const { data, error } = await svc()
    .from('growth_brand_settings')
    .select('*')
    .eq('id', 1)
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ data })
}

const putSchema = z.object({
  brand_voice:     z.string().min(1).max(2000).optional(),
  signature:       z.string().min(1).max(200).optional(),
  default_cta:     z.string().min(1).max(80).optional(),
  default_cta_url: z.string().url().optional(),
  legal_footer:    z.string().min(1).max(1000).optional(),
  social:          z.record(z.string(), z.string()).optional(),
})

export async function PUT(req: Request) {
  const g = await gate()
  if ('error' in g) return g.error

  const body = await req.json().catch(() => null)
  const parsed = putSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input', issues: parsed.error.flatten() }, { status: 422 })
  }

  const { data, error } = await svc()
    .from('growth_brand_settings')
    .upsert({ id: 1, ...parsed.data, updated_at: new Date().toISOString() })
    .select('*')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ data })
}
