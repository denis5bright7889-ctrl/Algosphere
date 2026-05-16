import { createServiceClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'

const PLAN_PRICING = {
  team:               { perSeat: 199, minSeats: 10, label: 'Team' },
  business:           { flat: 5000,  minSeats: 50, label: 'Business' },
  white_label:        { flat: 15000, minSeats: 0,  label: 'White Label' },
  broker_partnership: { flat: 0,     minSeats: 0,  label: 'Broker Partnership (custom)' },
} as const

const schema = z.object({
  org_name:      z.string().min(2).max(120),
  contact_email: z.string().email(),
  contact_name:  z.string().max(120).optional(),
  org_domain:    z.string().max(120).optional(),
  plan:          z.enum(['team','business','white_label','broker_partnership']),
  seat_count:    z.number().int().min(1).max(10000).optional(),
  notes:         z.string().max(2000).optional(),
})

// Public enterprise enquiry — creates a 'lead' row, notifies sales.
export async function POST(req: Request) {
  const body   = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input', issues: parsed.error.flatten() }, { status: 422 })
  }

  const d = parsed.data
  const pricing = PLAN_PRICING[d.plan]
  const svc = createServiceClient()

  const seats = Math.max(d.seat_count ?? pricing.minSeats, pricing.minSeats)
  const insert: Record<string, unknown> = {
    org_name:      d.org_name,
    org_domain:    d.org_domain ?? null,
    contact_email: d.contact_email,
    contact_name:  d.contact_name ?? null,
    plan:          d.plan,
    seat_count:    seats,
    status:        'lead',
    notes:         d.notes ?? null,
  }
  if ('perSeat' in pricing) insert.price_per_seat   = pricing.perSeat
  if ('flat' in pricing)    insert.flat_monthly_fee = pricing.flat

  const { data, error } = await svc
    .from('enterprise_licenses')
    .insert(insert)
    .select('id, plan, seat_count')
    .single()

  if (error) {
    console.error('enterprise lead error:', error)
    return NextResponse.json({ error: 'Failed to submit enquiry' }, { status: 500 })
  }

  const estMonthly = 'perSeat' in pricing
    ? pricing.perSeat * seats
    : 'flat' in pricing ? pricing.flat : 0

  return NextResponse.json({
    ok: true,
    lead_id: data.id,
    estimate_monthly_usd: estMonthly,
    message: 'Enquiry received. Our team will reach out within 1 business day.',
  })
}

// Pricing reference for the enterprise page
export async function GET() {
  return NextResponse.json({
    plans: Object.entries(PLAN_PRICING).map(([key, v]) => ({
      key,
      label:     v.label,
      per_seat:  'perSeat' in v ? v.perSeat : null,
      flat:      'flat' in v ? v.flat : null,
      min_seats: v.minSeats,
    })),
  })
}
