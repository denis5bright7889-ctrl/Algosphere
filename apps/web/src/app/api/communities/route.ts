import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'

function slugify(s: string) {
  return s.toLowerCase().trim().replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-').replace(/-+/g, '-').slice(0, 60)
}

// List active communities, or own (?scope=mine)
export async function GET(req: Request) {
  const supabase = await createClient()
  const { searchParams } = new URL(req.url)
  const scope = searchParams.get('scope')

  let query = supabase
    .from('premium_communities')
    .select(`*, profiles!premium_communities_owner_id_fkey ( public_handle )`)
    .order('member_count', { ascending: false })
    .limit(50)

  if (scope === 'mine') {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    query = query.eq('owner_id', user.id)
  } else {
    query = query.eq('status', 'active')
  }

  const { data, error } = await query
  if (error) return NextResponse.json({ error: 'Failed' }, { status: 500 })
  return NextResponse.json({ communities: data ?? [] })
}

const createSchema = z.object({
  name:          z.string().min(3).max(80),
  description:   z.string().max(2000).optional(),
  price_monthly: z.number().min(0).max(10000),
  price_annual:  z.number().min(0).optional(),
  is_free:       z.boolean().default(false),
  perks:         z.array(z.string().max(80)).max(10).default([]),
  telegram_invite_link: z.string().url().optional(),
})

export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body   = await req.json().catch(() => null)
  const parsed = createSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input' }, { status: 422 })
  }

  let slug = slugify(parsed.data.name)
  const { data: exists } = await supabase
    .from('premium_communities').select('id').eq('slug', slug).maybeSingle()
  if (exists) slug = `${slug}-${Math.random().toString(36).slice(2, 6)}`

  const { data, error } = await supabase
    .from('premium_communities')
    .insert({ ...parsed.data, owner_id: user.id, slug, status: 'active' })
    .select()
    .single()

  if (error) {
    console.error('community create error:', error)
    return NextResponse.json({ error: 'Failed to create' }, { status: 500 })
  }
  return NextResponse.json({ community: data }, { status: 201 })
}
