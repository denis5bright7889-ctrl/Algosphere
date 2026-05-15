import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as serviceClient } from '@supabase/supabase-js'
import { isAdmin } from '@/lib/admin'

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !isAdmin(user.email)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { searchParams } = new URL(request.url)
  const search = searchParams.get('search') ?? ''
  const tier = searchParams.get('tier') ?? 'all'
  const page = Math.max(1, parseInt(searchParams.get('page') ?? '1'))
  const limit = 20
  const offset = (page - 1) * limit

  const svc = serviceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  let query = svc
    .from('profiles')
    .select('id, full_name, subscription_tier, subscription_status, telegram_chat_id, created_at', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (tier !== 'all') query = query.eq('subscription_tier', tier)
  if (search) query = query.ilike('full_name', `%${search}%`)

  const { data, error, count } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ data, total: count ?? 0, page, limit })
}
