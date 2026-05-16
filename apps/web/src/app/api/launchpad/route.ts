import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'

const SERVICE_FEES = {
  standard:     2500,   // token + site + dashboard
  premium:      7500,   // + liquidity lock + vesting + investor portal
  full_managed: 20000,  // + treasury mgmt + AI launch assistant + marketing
} as const

function slugify(s: string) {
  return s.toLowerCase().trim().replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-').replace(/-+/g, '-').slice(0, 60)
}

export async function GET(req: Request) {
  const supabase = await createClient()
  const { searchParams } = new URL(req.url)
  const scope = searchParams.get('scope')

  let query = supabase
    .from('token_launches')
    .select(`*, profiles!token_launches_founder_id_fkey ( public_handle )`)
    .order('created_at', { ascending: false })
    .limit(50)

  if (scope === 'mine') {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    query = query.eq('founder_id', user.id)
  } else {
    query = query.in('status', ['presale', 'live', 'listed'])
  }

  const { data, error } = await query
  if (error) return NextResponse.json({ error: 'Failed' }, { status: 500 })
  return NextResponse.json({ launches: data ?? [], service_fees: SERVICE_FEES })
}

const createSchema = z.object({
  project_name:  z.string().min(2).max(120),
  ticker:        z.string().min(2).max(12).toUpperCase(),
  chain:         z.enum(['ethereum','bsc','polygon','arbitrum','base','solana']),
  description:   z.string().max(5000).optional(),
  total_supply:  z.number().positive().optional(),
  soft_cap_usd:  z.number().positive().optional(),
  hard_cap_usd:  z.number().positive().optional(),
  service_tier:  z.enum(['standard','premium','full_managed']).default('standard'),
  tokenomics:    z.record(z.string(), z.number()).optional(),
})

export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body   = await req.json().catch(() => null)
  const parsed = createSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input', issues: parsed.error.flatten() }, { status: 422 })
  }

  const d = parsed.data
  let slug = slugify(d.project_name)
  const { data: exists } = await supabase
    .from('token_launches').select('id').eq('slug', slug).maybeSingle()
  if (exists) slug = `${slug}-${Math.random().toString(36).slice(2, 6)}`

  const { data, error } = await supabase
    .from('token_launches')
    .insert({
      founder_id:      user.id,
      project_name:    d.project_name,
      slug,
      ticker:          d.ticker,
      chain:           d.chain,
      description:     d.description ?? null,
      total_supply:    d.total_supply ?? null,
      soft_cap_usd:    d.soft_cap_usd ?? null,
      hard_cap_usd:    d.hard_cap_usd ?? null,
      tokenomics:      d.tokenomics ?? {},
      service_tier:    d.service_tier,
      service_fee_usd: SERVICE_FEES[d.service_tier],
      status:          'draft',
    })
    .select()
    .single()

  if (error) {
    console.error('launch create error:', error)
    return NextResponse.json({ error: 'Failed to create launch' }, { status: 500 })
  }
  return NextResponse.json({ launch: data, service_fee: SERVICE_FEES[d.service_tier] }, { status: 201 })
}
