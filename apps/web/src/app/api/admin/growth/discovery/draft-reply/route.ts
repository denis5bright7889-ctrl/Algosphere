/**
 * /api/admin/growth/discovery/draft-reply — generate an AI reply
 * draft for a discovery_item.
 *
 * The draft is suggested. The admin reviews it, edits it, and posts
 * it manually from the AlgoSphere brand account on the original
 * platform. The system NEVER posts to external platforms on the
 * admin's behalf.
 *
 * Each draft generated stamps growth_discovery_items.ai_reply_draft +
 * ai_reply_at and flips status to 'drafting'.
 */
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient as serviceClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { isAdmin } from '@/lib/admin'
import { generateText, AIError, isAIAvailable } from '@/lib/ai'

export const dynamic = 'force-dynamic'

const schema = z.object({ id: z.string().uuid() })

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

const SYSTEM = [
  'You are a senior trading-platform support engineer replying to a public Reddit post',
  'on behalf of AlgoSphere Quant — an AI Trader Intelligence platform.',
  '',
  'YOUR RULES (non-negotiable):',
  '  • Identify openly as AlgoSphere. Never pretend to be a hobbyist trader.',
  '  • Be useful first, promotional second. If the OP\'s question has a',
  '    real answer that doesn\'t require AlgoSphere, lead with that.',
  '  • At most ONE link, and only when it directly serves the question.',
  '    Use https://algospherequant.com/<deep-link>.',
  '  • Cite concrete platform features by name (Backtester, Quant Builder,',
  '    Journal Intelligence, Risk Gate) — never invent capabilities.',
  '  • Never claim or imply guaranteed performance. Backtest ≠ future.',
  '  • 80–160 words. Conversational, no marketing-speak.',
  '  • End with one sentence inviting follow-up questions in-thread.',
  '  • DO NOT include emojis, hashtags, or "Hope this helps!".',
  '',
  'OUTPUT ONLY the reply text. No preamble. No quoting the OP.',
].join('\n')

export async function POST(req: Request) {
  const g = await gate()
  if ('error' in g) return g.error

  if (!isAIAvailable()) {
    return NextResponse.json({ error: 'AI provider not configured (AI_STUDIO_API_KEY / GEMINI_API_KEY).' }, { status: 503 })
  }

  const body = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid input' }, { status: 422 })

  const db = svc()
  const { data: item, error: lookupErr } = await db
    .from('growth_discovery_items')
    .select('id, source, title, snippet, url, topic_tags')
    .eq('id', parsed.data.id)
    .maybeSingle()

  if (lookupErr || !item) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const prompt = [
    `Source: ${item.source}`,
    `Topics: ${(item.topic_tags ?? []).join(', ') || 'general trading'}`,
    `URL: ${item.url}`,
    '',
    'POST TITLE:',
    item.title,
    '',
    'POST BODY:',
    item.snippet ?? '(no body — title-only post)',
  ].join('\n')

  let draft: string
  try {
    draft = await generateText({
      prompt,
      systemInstruction: SYSTEM,
      model:             'gemini-flash-latest',
      maxTokens:         600,
      temperature:       0.5,
      timeoutMs:         20_000,
    })
  } catch (e) {
    if (e instanceof AIError && e.code === 'quota') {
      return NextResponse.json({ error: 'AI quota exceeded — try again later.' }, { status: 429 })
    }
    return NextResponse.json({ error: e instanceof Error ? e.message : 'AI failed' }, { status: 500 })
  }

  if (!draft || draft.trim().length < 20) {
    return NextResponse.json({ error: 'AI returned an empty/short draft.' }, { status: 502 })
  }

  await db.from('growth_discovery_items')
    .update({
      ai_reply_draft: draft.trim(),
      ai_reply_at:    new Date().toISOString(),
      status:         'drafting',
      reviewed_by:    g.user.id,
      reviewed_at:    new Date().toISOString(),
    })
    .eq('id', item.id)

  return NextResponse.json({ ok: true, draft: draft.trim() })
}
