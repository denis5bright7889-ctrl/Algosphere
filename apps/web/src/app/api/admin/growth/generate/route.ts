/**
 * /api/admin/growth/generate — produce a draft from real platform data.
 *
 * Phase 1 supports two real-data generators and two free-form ones.
 * In all cases the response is a DRAFT row (status='draft') already
 * persisted to growth_content_items, ready for the editor / approval
 * pipeline. Reviewers can edit before flipping status → review.
 *
 * Compliance: every body produced here is generated from concrete
 * verifiable inputs the admin supplied; nothing is fabricated. Drafts
 * carry the full `provenance` jsonb so a reviewer can audit the source.
 */
import { NextResponse } from 'next/server'
import { createClient as serviceClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { isAdmin } from '@/lib/admin'
import {
  generateStrategyOfTheWeek, generateBacktestBreakdown,
  generateEducational,      generateProductUpdate,
  generateMarketReport,
  type GeneratedDraft,
} from '@/lib/growth/generators'

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


const sotwSchema = z.object({
  kind:    z.literal('strategy_of_the_week'),
  payload: z.object({
    strategy: z.object({
      id:               z.string(),
      name:             z.string(),
      description:      z.string().nullable().optional(),
      head_version_id:  z.string().nullable().optional(),
      template_key:     z.string().nullable().optional(),
    }),
    backtest: z.object({
      run_id:        z.string().optional(),
      symbol:        z.string(),
      timeframe:     z.string(),
      window_label:  z.string(),
      trades:        z.number().int().nonnegative(),
      win_rate:      z.number().min(0).max(1),
      profit_factor: z.number().nullable(),
      net_pnl_pct:   z.number(),
      max_drawdown:  z.number().min(0).max(1),
      sharpe:        z.number().nullable(),
    }),
    grade: z.object({
      letter:     z.enum(['A','B','C','D','F','N/A']),
      score:      z.number().nullable(),
      confidence: z.enum(['low','medium','high']),
    }),
  }),
})

const breakdownSchema = z.object({
  kind: z.literal('backtest_breakdown'),
  payload: z.object({
    symbol:        z.string(),
    timeframe:     z.string(),
    window_label:  z.string(),
    strategy_name: z.string(),
    bt: z.object({
      trades:        z.number().int().nonnegative(),
      win_rate:      z.number().min(0).max(1),
      profit_factor: z.number().nullable(),
      net_pnl_pct:   z.number(),
      max_drawdown:  z.number().min(0).max(1),
      sharpe:        z.number().nullable(),
      avg_win:       z.number(),
      avg_loss:      z.number(),
    }),
    recommendations: z.array(z.object({
      title:     z.string(),
      rationale: z.string(),
    })).optional(),
  }),
})

const educationalSchema = z.object({
  kind: z.literal('educational'),
  payload: z.object({
    topic:       z.string().min(1),
    headline:    z.string().min(1).max(200),
    body:        z.string().min(50),
    reading_min: z.number().int().min(1).max(60),
  }),
})

const productUpdateSchema = z.object({
  kind: z.literal('product_update'),
  payload: z.object({
    version:    z.string().min(1),
    headline:   z.string().min(1).max(200),
    highlights: z.array(z.string().min(1).max(280)).min(1).max(8),
    link_label: z.string().max(60).optional(),
    link_url:   z.string().url().optional(),
  }),
})

const marketReportSchema = z.object({
  kind: z.literal('market_report'),
  payload: z.object({
    window_label: z.string().min(1),
    cadence:      z.enum(['daily','weekly','monthly']),
    rows: z.array(z.object({
      symbol: z.string(),
      regime: z.string(),
      note:   z.string().optional(),
    })).min(1).max(100),
  }),
})

const reqSchema = z.discriminatedUnion('kind', [
  sotwSchema, breakdownSchema, educationalSchema, productUpdateSchema, marketReportSchema,
])

export async function POST(req: Request) {
  const g = await gate()
  if ('error' in g) return g.error

  const body = await req.json().catch(() => null)
  const parsed = reqSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input', issues: parsed.error.flatten() }, { status: 422 })
  }

  let draft: GeneratedDraft
  switch (parsed.data.kind) {
    case 'strategy_of_the_week':
      draft = generateStrategyOfTheWeek(parsed.data.payload)
      break
    case 'backtest_breakdown':
      draft = generateBacktestBreakdown(parsed.data.payload)
      break
    case 'educational':
      draft = generateEducational(parsed.data.payload)
      break
    case 'product_update':
      draft = generateProductUpdate(parsed.data.payload)
      break
    case 'market_report':
      draft = generateMarketReport(parsed.data.payload)
      break
  }

  const { data, error } = await svc()
    .from('growth_content_items')
    .insert({
      kind:         draft.kind,
      status:       'draft',
      title:        draft.title,
      summary:      draft.summary,
      body_md:      draft.body_md,
      tags:         draft.tags,
      is_synthetic: draft.is_synthetic,
      disclaimer:   draft.disclaimer,
      cta_text:     draft.cta_text,
      cta_url:      draft.cta_url,
      provenance:   draft.provenance,
      created_by:   g.user.id,
    })
    .select('*')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ data }, { status: 201 })
}
