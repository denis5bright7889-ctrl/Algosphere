import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'

// White-label config — VIP/enterprise owners only.
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data } = await supabase
    .from('whitelabel_configs')
    .select('*')
    .eq('owner_id', user.id)
    .maybeSingle()

  return NextResponse.json({ config: data ?? null })
}

const schema = z.object({
  brand_name:    z.string().min(2).max(60),
  primary_color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).default('#D4A017'),
  logo_url:      z.string().url().optional(),
  custom_domain: z.string().max(120).optional(),
  support_email: z.string().email().optional(),
  hide_algosphere_branding: z.boolean().default(false),
})

export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Gate: VIP tier required for white-label
  const { data: profile } = await supabase
    .from('profiles')
    .select('subscription_tier')
    .eq('id', user.id)
    .single()

  if ((profile?.subscription_tier ?? 'free') !== 'vip') {
    return NextResponse.json(
      { error: 'White-label requires VIP / Institutional tier' },
      { status: 403 },
    )
  }

  const body   = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input' }, { status: 422 })
  }

  const { data, error } = await supabase
    .from('whitelabel_configs')
    .upsert({
      owner_id:   user.id,
      ...parsed.data,
      status:     'pending',
      updated_at: new Date().toISOString(),
    }, { onConflict: 'owner_id' })
    .select()
    .single()

  if (error) {
    console.error('whitelabel error:', error)
    return NextResponse.json({ error: 'Failed to save' }, { status: 500 })
  }
  return NextResponse.json({
    config: data,
    message: 'Saved. Custom domain activation is reviewed within 2 business days.',
  })
}
