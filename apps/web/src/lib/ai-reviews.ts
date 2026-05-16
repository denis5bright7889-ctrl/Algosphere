/**
 * AI Trade Review — Gemini-powered analysis of a single journal entry.
 *
 * Produces a coaching review + a 0-100 quality score the existing
 * `journal_entries.ai_review` and `.ai_score` columns expect.
 */

import { generateJSON, isAIAvailable, AIError } from './ai'

interface ReviewInput {
  pair?:           string | null
  direction?:      string | null
  entry_price?:    number | null
  exit_price?:     number | null
  stop_loss?:      number | null
  take_profit?:    number | null
  lot_size?:       number | null
  pips?:           number | null
  pnl?:            number | null
  risk_amount?:    number | null
  risk_pct?:       number | null
  setup_tag?:      string | null
  notes?:          string | null
  emotion_pre?:    string | null
  emotion_post?:   string | null
  session?:        string | null
  timeframe?:      string | null
  market_context?: string | null
  mistakes?:       string[] | null
  rule_violation?: boolean | null
}

export interface TradeReviewResult {
  score:        number    // 0-100
  grade:        'A+' | 'A' | 'B+' | 'B' | 'C' | 'D' | 'F'
  summary:      string    // 1-2 sentences
  strengths:    string[]  // 1-3 items
  weaknesses:   string[]  // 0-3 items
  advice:       string    // 1-2 actionable sentences
}

function isReview(x: unknown): x is TradeReviewResult {
  if (!x || typeof x !== 'object') return false
  const r = x as Record<string, unknown>
  return typeof r.score === 'number'
      && typeof r.grade === 'string'
      && typeof r.summary === 'string'
      && Array.isArray(r.strengths)
      && Array.isArray(r.weaknesses)
      && typeof r.advice === 'string'
}

const SYSTEM = `You are a senior trading psychologist and risk manager reviewing a
trader's single trade. Be concise, direct, and evidence-based. Never moralize.
Score 0-100 based on:
 - Risk management discipline (40%)
 - Setup quality and timing (25%)
 - Execution (TP/SL adherence) (20%)
 - Emotional state alignment (15%)
A "win" with broken rules can still score low. A small "loss" with perfect
discipline can score 70+. Output JSON only.`

function formatTrade(t: ReviewInput): string {
  const lines = [
    `Pair: ${t.pair ?? '—'} | Direction: ${t.direction ?? '—'}`,
    `Entry: ${t.entry_price ?? '—'} → Exit: ${t.exit_price ?? '—'}`,
    `SL: ${t.stop_loss ?? '—'}  TP: ${t.take_profit ?? '—'}`,
    `Lot: ${t.lot_size ?? '—'}  Pips: ${t.pips ?? '—'}  P&L: ${t.pnl ?? '—'}`,
    `Risk: $${t.risk_amount ?? '—'} (${t.risk_pct ?? '—'}%)`,
    `Setup: ${t.setup_tag ?? '—'}  Session: ${t.session ?? '—'}  TF: ${t.timeframe ?? '—'}`,
    `Market context: ${t.market_context ?? '—'}`,
    `Emotion before: ${t.emotion_pre ?? '—'}  | after: ${t.emotion_post ?? '—'}`,
    `Mistakes flagged: ${t.mistakes?.length ? t.mistakes.join(', ') : 'none'}`,
    `Rule violation: ${t.rule_violation ? 'YES' : 'no'}`,
    `Notes: ${t.notes ?? '—'}`,
  ]
  return lines.join('\n')
}

export async function reviewTrade(trade: ReviewInput): Promise<TradeReviewResult | null> {
  if (!isAIAvailable()) return null

  const prompt = `Review this trade and output JSON with this exact schema:

{
  "score": <number 0-100>,
  "grade": "<A+|A|B+|B|C|D|F>",
  "summary": "<one or two sentence overall>",
  "strengths": ["<short bullet>", ...],
  "weaknesses": ["<short bullet>", ...],
  "advice": "<one or two actionable sentences>"
}

Trade details:
${formatTrade(trade)}`

  try {
    return await generateJSON<TradeReviewResult>({
      prompt,
      systemInstruction: SYSTEM,
      validate:          isReview,
      maxTokens:         600,
      temperature:       0.4,
    })
  } catch (e) {
    if (e instanceof AIError) {
      console.error(`AI review failed (${e.code}):`, e.message)
    } else {
      console.error('AI review error:', e)
    }
    return null
  }
}
