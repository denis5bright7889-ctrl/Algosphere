/**
 * AI Psychology Coach — weekly behavioral analysis over journal aggregates.
 */

import { generateJSON, isAIAvailable, AIError } from './ai'

export interface PsychologyReport {
  discipline_score:  number    // 0-100
  patience_score:    number
  risk_mgmt_score:   number
  consistency_score: number
  overall_score:     number
  primary_strength:  string
  primary_weakness:  string
  top_mistakes:      string[]
  patterns:          string[]
  coaching:          string    // 2-3 paragraphs
  action_plan:       string[]
}

function isReport(x: unknown): x is PsychologyReport {
  if (!x || typeof x !== 'object') return false
  const r = x as Record<string, unknown>
  return typeof r.discipline_score  === 'number'
      && typeof r.patience_score    === 'number'
      && typeof r.risk_mgmt_score   === 'number'
      && typeof r.consistency_score === 'number'
      && typeof r.overall_score     === 'number'
      && typeof r.primary_strength  === 'string'
      && typeof r.primary_weakness  === 'string'
      && Array.isArray(r.top_mistakes)
      && Array.isArray(r.patterns)
      && typeof r.coaching          === 'string'
      && Array.isArray(r.action_plan)
}

export interface PsychInputs {
  total_trades:     number
  wins:             number
  losses:           number
  net_pnl:          number
  win_rate:         number
  avg_rr:           number
  max_drawdown:     number
  rule_violations:  number
  mistake_counts:   Record<string, number>  // mistake_type → frequency
  emotion_breakdown: Record<string, number> // emotion → trade count
  best_emotion:     string | null
  worst_emotion:    string | null
}

const SYSTEM = `You are a senior trading psychologist analyzing a trader's last
30 days. Be specific, evidence-based, non-judgemental. Reference exact numbers
from the data. Each score 0-100 weighted: discipline (rule adherence + risk
sizing), patience (vs FOMO/revenge), risk_mgmt (drawdown + sizing), consistency
(month-over-month variance proxy). Overall is weighted average. Output JSON only.`

export async function generatePsychologyReport(
  inp: PsychInputs,
): Promise<PsychologyReport | null> {
  if (!isAIAvailable())            return null
  if (inp.total_trades < 5)        return null

  const mistakeLines = Object.entries(inp.mistake_counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([k, v]) => `  - ${k}: ${v} occurrences`)
    .join('\n')

  const emotionLines = Object.entries(inp.emotion_breakdown)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `  - ${k}: ${v} trades`)
    .join('\n')

  const prompt = `Analyze this 30-day trading record and output JSON:

{
  "discipline_score":  <0-100>,
  "patience_score":    <0-100>,
  "risk_mgmt_score":   <0-100>,
  "consistency_score": <0-100>,
  "overall_score":     <0-100>,
  "primary_strength":  "<one sentence>",
  "primary_weakness":  "<one sentence>",
  "top_mistakes":      ["<3 items>"],
  "patterns":          ["<2-4 observed patterns>"],
  "coaching":          "<2-3 paragraphs, personalized>",
  "action_plan":       ["<3 specific actions>"]
}

Stats:
  Total trades:     ${inp.total_trades}
  Wins / Losses:    ${inp.wins} / ${inp.losses}
  Win rate:         ${(inp.win_rate * 100).toFixed(1)}%
  Net P&L:          $${inp.net_pnl.toFixed(2)}
  Avg R:R:          1:${inp.avg_rr.toFixed(2)}
  Max drawdown:     ${(inp.max_drawdown * 100).toFixed(1)}%
  Rule violations:  ${inp.rule_violations}

Mistake breakdown:
${mistakeLines || '  - none logged'}

Emotion breakdown (pre-trade):
${emotionLines || '  - none logged'}
  Best-performing emotion: ${inp.best_emotion ?? 'unknown'}
  Worst-performing emotion: ${inp.worst_emotion ?? 'unknown'}`

  try {
    return await generateJSON<PsychologyReport>({
      prompt,
      systemInstruction: SYSTEM,
      validate:          isReport,
      maxTokens:         1500,
      temperature:       0.5,
    })
  } catch (e) {
    if (e instanceof AIError) {
      console.error(`Psychology AI failed (${e.code}):`, e.message)
    }
    return null
  }
}
