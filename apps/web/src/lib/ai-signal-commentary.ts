/**
 * AI Signal Commentary — auto-post helper.
 *
 * When a creator publishes a signal AND has auto_post_signals enabled in their
 * preferences (default: ON), a Gemini-written 1-3 sentence commentary is
 * posted to their social feed as a `signal_share` post.
 *
 * The post links the signal_id so PostCard renders the embedded card.
 * Non-blocking — failures log, never throw.
 */

import { generateText, isAIAvailable } from '@/lib/ai'
import { createServiceClient } from '@/lib/supabase/server'

interface SignalForCommentary {
  id:               string
  pair:             string
  direction:        'buy' | 'sell'
  entry_price:      number
  stop_loss:        number
  take_profit_1:    number | null
  risk_reward:      number | null
  confidence_score: number | null
  regime:           string | null
  session:          string | null
  tier_required:    string
  created_by:       string
}

const SYSTEM = `You are a senior technical analyst writing concise trade commentary
for a verified trading signal. Style: professional, evidence-based, never hype.
Output exactly 2-3 sentences. No emojis except direction arrow. No "DYOR" or
advice disclaimers — the platform handles those. Mention the regime, session, or
R:R if they meaningfully strengthen the call. Avoid generic phrasing.`

function buildPrompt(s: SignalForCommentary): string {
  const dir = s.direction === 'buy' ? '↑ BUY' : '↓ SELL'
  return `Write commentary for this signal:

  Pair:        ${s.pair}
  Direction:   ${dir}
  Entry:       ${s.entry_price}
  Stop Loss:   ${s.stop_loss}
  ${s.take_profit_1 != null ? `Take Profit: ${s.take_profit_1}` : ''}
  ${s.risk_reward      != null ? `R:R:         ${s.risk_reward}` : ''}
  ${s.confidence_score != null ? `Confidence:  ${s.confidence_score}/100` : ''}
  ${s.regime  ? `Regime:      ${s.regime}` : ''}
  ${s.session ? `Session:     ${s.session}` : ''}`
}

/**
 * Build commentary + insert a social post. Returns post_id or null on
 * any failure (always safe to ignore the return).
 */
export async function autoPostSignalCommentary(
  signal: SignalForCommentary,
): Promise<string | null> {
  if (!isAIAvailable()) return null

  const svc = createServiceClient()

  // Check the creator's auto-post preference (default: ON for verified traders)
  const { data: prefs } = await svc
    .from('notification_preferences')
    .select('routing_rules')
    .eq('user_id', signal.created_by)
    .maybeSingle()

  // Stored as { auto_post_signals: false } if explicitly disabled
  const disabled = prefs?.routing_rules
    && (prefs.routing_rules as Record<string, unknown>).auto_post_signals === false
  if (disabled) return null

  let body: string
  try {
    body = (await generateText({
      prompt:            buildPrompt(signal),
      systemInstruction: SYSTEM,
      maxTokens:         200,
      temperature:       0.6,
    })).trim()
  } catch (err) {
    console.error('Signal commentary generation failed:', err)
    return null
  }

  if (!body || body.length < 10) return null

  const { data, error } = await svc
    .from('social_posts')
    .insert({
      author_id:   signal.created_by,
      body:        body.slice(0, 2000),
      post_type:   'signal_share',
      signal_id:   signal.id,
      visibility:  signal.tier_required === 'free' ? 'public' : 'followers',
    })
    .select('id')
    .single()

  if (error) {
    console.error('Signal commentary post insert failed:', error)
    return null
  }
  return data?.id ?? null
}
