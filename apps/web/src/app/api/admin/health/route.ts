import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as serviceClient } from '@supabase/supabase-js'
import { isAdmin } from '@/lib/admin'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !isAdmin(user.email)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const start = Date.now()
  const svc = serviceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  // DB ping
  let dbStatus = 'ok'
  let dbLatency = 0
  try {
    const t = Date.now()
    await svc.from('profiles').select('id').limit(1)
    dbLatency = Date.now() - t
  } catch {
    dbStatus = 'error'
  }

  // Count active sessions (profiles updated in last 30min — proxy)
  const { count: activeSessions } = await svc
    .from('crypto_payments')
    .select('*', { count: 'exact', head: true })
    .gte('created_at', new Date(Date.now() - 30 * 60000).toISOString())

  const { count: pendingPayments } = await svc
    .from('crypto_payments')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'pending_review')

  return NextResponse.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime ? Math.round(process.uptime()) : null,
    services: {
      database: { status: dbStatus, latencyMs: dbLatency },
      supabase: { status: 'ok', url: process.env.NEXT_PUBLIC_SUPABASE_URL ? 'configured' : 'missing' },
      payments: { status: 'ok', provider: 'BINANCE/TRC20', enabled: process.env.BINANCE_PAYMENT_ENABLED === 'true' },
      adminEmail: { status: process.env.ADMIN_EMAIL ? 'configured' : 'missing' },
    },
    metrics: {
      pendingPayments: pendingPayments ?? 0,
      recentActivity: activeSessions ?? 0,
    },
  })
}
