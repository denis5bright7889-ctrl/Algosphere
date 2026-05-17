/**
 * Lightweight toxicity check using Gemini. Returns a score 0-1 with a
 * short reason. Degrades gracefully — if AI is not configured or the
 * call errors/times out, we return { score: 0, ok: true } so posting
 * is never blocked by an outage.
 */
import { generateJSON, isAIAvailable, AIError } from '@/lib/ai'

export interface ToxicityResult {
  score:  number    // 0 (clean) → 1 (egregious)
  reason: string    // one short sentence
  ok:     boolean   // false if score above threshold OR check failed safely
}

const THRESHOLD = 0.75
const SYSTEM = `You are a content-moderation classifier for a trading-community feed.
Score the user's post for toxicity, harassment, hate speech, doxxing, and incitement
ONLY — not for being negative about a trade or critical of a strategy. Trading
disagreement and bearish takes are fine.

Return STRICT JSON: { "score": <0..1>, "reason": "<<=12 words>" }.`

interface Raw { score: number; reason: string }
function isRaw(v: unknown): v is Raw {
  return (
    typeof v === 'object' && v !== null
    && typeof (v as Raw).score === 'number'
    && typeof (v as Raw).reason === 'string'
  )
}

export async function checkToxicity(text: string): Promise<ToxicityResult> {
  // Degrade gracefully if AI isn't wired up.
  if (!isAIAvailable()) return { score: 0, reason: 'AI off', ok: true }

  try {
    const raw = await generateJSON<Raw>({
      prompt:            `${SYSTEM}\n\nPost:\n"""${text.slice(0, 2000)}"""`,
      validate:          isRaw,
      maxTokens:         60,
      temperature:       0.1,
      timeoutMs:         8000,
    })
    const score = Math.max(0, Math.min(1, raw.score))
    return { score, reason: raw.reason, ok: score < THRESHOLD }
  } catch (e) {
    // Never block posting on an AI outage — log and pass through.
    const code = e instanceof AIError ? e.code : 'unknown'
    console.warn(`toxicity check failed (${code}) — passing through`)
    return { score: 0, reason: 'check unavailable', ok: true }
  }
}
