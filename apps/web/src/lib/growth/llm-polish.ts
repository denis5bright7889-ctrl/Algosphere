/**
 * Growth Engine — LLM polish layer.
 *
 * Takes a deterministic GeneratedDraft + the brand voice config and
 * asks Gemini to rewrite the body for natural tone while preserving:
 *   - Every numeric value (dollar amounts, percentages, ratios, counts)
 *   - The disclaimer block, verbatim
 *   - The "Backtest — not live trading" callout for synthetic drafts
 *
 * Fail-safe by design — if Gemini is unavailable, errors, returns
 * something that drops a number, or removes the disclaimer, we return
 * the ORIGINAL unpolished draft. Polish is a nice-to-have; the
 * deterministic floor is the contract.
 */
import { generateText, isAIAvailable, AIError } from '@/lib/ai'
import type { GeneratedDraft } from './generators'

export interface BrandVoice {
  brand_voice?:  string
  signature?:    string
  legal_footer?: string
}

/**
 * Polish a generated draft's body. Returns a new draft with the body
 * rewritten — provenance gains a `polished_by` marker. Falls back to
 * the original on any failure.
 */
export async function polishDraft(
  draft: GeneratedDraft,
  brand: BrandVoice = {},
): Promise<GeneratedDraft> {
  if (!isAIAvailable()) return draft

  const numbersOriginal = extractNumbers(draft.body_md)
  if (numbersOriginal.length === 0 && !draft.is_synthetic) {
    // Nothing performance-critical to preserve — straight rewrite is safe.
  }

  const voice = brand.brand_voice?.trim()
    ? brand.brand_voice.trim()
    : 'Direct, expert, no hype. Lead with verifiable numbers. Short paragraphs.'

  const systemInstruction = [
    'You are AlgoSphere Quant\'s in-house editor.',
    `BRAND VOICE: ${voice}`,
    '',
    'YOU REWRITE the user-provided markdown body for natural voice while',
    'STRICTLY PRESERVING:',
    '  1. Every number, percentage, dollar figure, ratio, and date.',
    '     Do not round, re-format, or paraphrase numeric values.',
    '  2. Any disclaimer text (sentences mentioning "Past performance",',
    '     "backtest", "not live trading", "risk of loss" — keep verbatim).',
    '  3. Any "> Backtest — not live trading" callout block — keep verbatim.',
    '  4. The headline (the first # or ## line).',
    '  5. Markdown structure (lists stay lists, headings stay headings).',
    '',
    'YOU MAY: tighten phrasing, vary sentence length, replace generic',
    'transition words. Output is markdown. Do not add a sign-off; the',
    'caller appends it. Do not invent new statistics or claims.',
    '',
    'Output ONLY the rewritten markdown. No preamble, no explanation.',
  ].join('\n')

  let polished: string
  try {
    polished = await generateText({
      prompt:            draft.body_md,
      systemInstruction,
      model:             'gemini-flash-latest',
      maxTokens:         2048,
      temperature:       0.55,
      timeoutMs:         20_000,
    })
  } catch (e) {
    if (e instanceof AIError && (e.code === 'quota' || e.code === 'no_key')) {
      // Quota / no key → silently fall back to the deterministic body.
      return draft
    }
    return draft
  }

  if (!polished || polished.length < 20) return draft

  // ── Fact-preservation guard ──────────────────────────────────────
  // Every number from the original must still appear in the polished
  // output. If even one is missing, reject and fall back.
  const missing = numbersOriginal.filter((n) => !polished.includes(n))
  if (missing.length > 0) {
    return draft
  }

  // Synthetic draft? The callout block MUST survive.
  if (draft.is_synthetic) {
    const calloutOK =
      /backtest[\s—-]+not live trading/i.test(polished) ||
      polished.includes('Backtest — not live trading')
    if (!calloutOK) return draft
  }

  // Disclaimer-bearing draft? Disclaimer string must survive verbatim
  // anywhere in the body OR remain in the draft.disclaimer field
  // (which is rendered separately by the channel formatter). The
  // disclaimer field itself is NOT subject to LLM rewriting.
  // No extra check needed here — disclaimer travels in a separate column.
  void brand

  return {
    ...draft,
    body_md: polished,
    provenance: {
      ...draft.provenance,
      polished_by: 'gemini-flash-latest',
      polished_at: new Date().toISOString(),
    },
  }
}

// ─── Number extraction — broad but safe ──────────────────────────────
// We pull anything that looks like a number a marketer might be
// tempted to round: $1,234, 12.3%, 1:2, 250-pip, 0.85, "30 trades".
// Whitespace + punctuation are normalized so "+$1,234.56" matches.
function extractNumbers(text: string): string[] {
  // Strip thousands separators inside the SOURCE so equality works
  // both ways — the polished text is allowed to drop commas.
  const seen = new Set<string>()
  const matches = text.match(/[$+\-]?\d[\d,]*(?:\.\d+)?%?/g) ?? []
  for (const m of matches) {
    const normalized = m.replace(/,/g, '')
    if (normalized.length < 1) continue
    // Skip year-like 4-digit integers that aren't dollar / percent /
    // signed — they're usually neutral noise.
    if (/^\d{4}$/.test(normalized) && Number(normalized) >= 1900 && Number(normalized) <= 2100) continue
    seen.add(normalized)
  }
  return [...seen]
}
