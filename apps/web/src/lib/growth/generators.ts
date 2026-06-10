/**
 * Growth Engine — content generators (Phase 1).
 *
 * Pure functions. No LLM calls in Phase 1 — every generator reads real
 * platform data (strategy config + backtest result + scanner snapshot
 * + journal aggregate) and produces a deterministic markdown draft.
 *
 * Compliance contract (mirrors the migration header):
 *   • Every returned draft carries a `provenance` pointer to the
 *     real source record so a reviewer can verify the claim.
 *   • Backtest-derived drafts ALWAYS set `is_synthetic: true` and
 *     start with a "Backtest — not live trading" callout line.
 *   • The disclaimer is non-empty and source-appropriate.
 *
 * Nothing here decides to publish. Generators only produce DRAFTS;
 * the admin UI is the publisher.
 */

export type ContentKind =
  | 'strategy_of_the_week'
  | 'backtest_breakdown'
  | 'market_report'
  | 'product_update'
  | 'psychology_insight'
  | 'educational'
  | 'announcement'
  | 'trade_breakdown'
  | 'coach_insights'
  | 'broker_truth'
  | 'performance_transparency'

export interface GeneratedDraft {
  kind:         ContentKind
  title:        string
  summary:      string
  body_md:      string
  tags:         string[]
  is_synthetic: boolean
  disclaimer:   string
  cta_text:     string
  cta_url:      string
  provenance:   Record<string, unknown>
}

// Disclaimer bank — versioned so a one-line edit propagates everywhere.
const DISC = {
  backtest:    'Hypothetical historical performance. Results are derived from a backtest on real OHLCV data; they are NOT live trading results and do not represent any individual user\'s account.',
  educational: 'Educational content only. Not investment advice. Trading involves risk of loss.',
  product:     'Product announcement.',
  market:      'Market analysis derived from the AlgoSphere engine\'s regime + liquidity snapshots. Not a trade recommendation.',
  psychology:  'Behavioural insight aggregated from anonymised platform data. Not investment advice.',
}

// ─── Strategy of the Week ─────────────────────────────────────────

export interface StrategyOfTheWeekInput {
  strategy: {
    id:               string
    name:             string
    description?:     string | null
    head_version_id?: string | null
    template_key?:    string | null
  }
  /** Latest backtest result for the strategy. Required — we never
   *  produce a "Strategy of the Week" without verifiable numbers. */
  backtest: {
    run_id?:        string
    symbol:         string
    timeframe:      string
    window_label:   string                  // e.g. "2024-09 → 2024-12"
    trades:         number
    win_rate:       number                  // 0..1
    profit_factor:  number | null
    net_pnl_pct:    number
    max_drawdown:   number                  // fraction 0..1
    sharpe:         number | null
  }
  /** From the strategy-grader. */
  grade: {
    letter:     'A' | 'B' | 'C' | 'D' | 'F' | 'N/A'
    score:      number | null
    confidence: 'low' | 'medium' | 'high'
  }
}

export function generateStrategyOfTheWeek(i: StrategyOfTheWeekInput): GeneratedDraft {
  const { strategy, backtest, grade } = i

  const ddPct  = (backtest.max_drawdown * 100).toFixed(1)
  const winPct = (backtest.win_rate     * 100).toFixed(0)
  const pf     = backtest.profit_factor != null ? backtest.profit_factor.toFixed(2) : '—'
  const sharpe = backtest.sharpe        != null ? backtest.sharpe.toFixed(2)        : '—'

  const title = `Strategy of the Week — ${strategy.name}`
  const summary =
    `${strategy.name} on ${backtest.symbol} ${backtest.timeframe}: ` +
    `${backtest.trades} trades · ${winPct}% win rate · ` +
    `PF ${pf} · ${ddPct}% max drawdown. ` +
    `Grade ${grade.letter} (${grade.confidence} confidence). `

  const body_md = [
    `> **Backtest result — not live trading.** This is a historical simulation on ${backtest.symbol} ${backtest.timeframe} over ${backtest.window_label}. No user account is referenced.`,
    '',
    `## ${strategy.name}`,
    '',
    strategy.description ? `${strategy.description}` : '',
    '',
    `### Key Metrics`,
    `- **Sample**: ${backtest.trades} trades · ${backtest.window_label}`,
    `- **Win rate**: ${winPct}%`,
    `- **Profit factor**: ${pf}`,
    `- **Net return**: ${backtest.net_pnl_pct >= 0 ? '+' : ''}${backtest.net_pnl_pct.toFixed(1)}%`,
    `- **Max drawdown**: ${ddPct}%`,
    `- **Sharpe**: ${sharpe}`,
    '',
    `### Grade`,
    `**${grade.letter}**${grade.score != null ? ` · ${grade.score}/100` : ''} · confidence: **${grade.confidence}**`,
    '',
    `### Deployment Readiness`,
    deploymentReadinessLine(grade, backtest),
    '',
    `### Notes`,
    `Backtests are not forward results. Validate on a different symbol or recent window before sizing any capital. Past performance is not a guarantee of future results.`,
  ].filter(Boolean).join('\n')

  return {
    kind:         'strategy_of_the_week',
    title,
    summary:      summary.trim(),
    body_md,
    tags:         ['strategy', backtest.symbol.toLowerCase(), 'backtest', strategy.template_key ?? 'custom'].filter(Boolean),
    is_synthetic: true,
    disclaimer:   DISC.backtest,
    cta_text:     'Build your own in AlgoSphere',
    cta_url:      '/quant-builder',
    provenance: {
      type:        'strategy_backtest',
      strategy_id: strategy.id,
      version_id:  strategy.head_version_id ?? null,
      run_id:      backtest.run_id ?? null,
      symbol:      backtest.symbol,
      timeframe:   backtest.timeframe,
      generated_at: new Date().toISOString(),
    },
  }
}

function deploymentReadinessLine(
  grade: StrategyOfTheWeekInput['grade'],
  bt:    StrategyOfTheWeekInput['backtest'],
): string {
  if (grade.letter === 'N/A' || grade.confidence === 'low') {
    return `**Not ready** — sample size is too thin (${bt.trades} trades) to ship. Run on a longer window first.`
  }
  if (grade.letter === 'F' || grade.letter === 'D') {
    return `**Not deployable** — the math doesn't support sizing capital against this configuration. Iterate on filters and re-test.`
  }
  if (bt.max_drawdown >= 0.30) {
    return `**Paper-trade only** — drawdown is at the unsurvivable edge. Forward-test in shadow mode before considering live size.`
  }
  if (grade.confidence === 'high' && (grade.letter === 'A' || grade.letter === 'B')) {
    return `**Forward-test ready** — sample is statistically meaningful, drawdown is in the survivable band. Shadow-trade for 2-4 weeks before sizing live.`
  }
  return `**Shadow-test recommended** — confidence is medium. Validate on a different symbol or the most recent window before any live exposure.`
}


// ─── Backtest Breakdown ───────────────────────────────────────────

export interface BacktestBreakdownInput {
  symbol:        string
  timeframe:     string
  window_label:  string
  strategy_name: string
  bt: {
    trades:         number
    win_rate:       number
    profit_factor:  number | null
    net_pnl_pct:    number
    max_drawdown:   number
    sharpe:         number | null
    avg_win:        number
    avg_loss:       number
  }
  /** From StrategyCoachPanel — gives this content the "what to do
   *  next" arc which is the strongest growth-content hook. */
  recommendations?: Array<{ title: string; rationale: string }>
}

export function generateBacktestBreakdown(i: BacktestBreakdownInput): GeneratedDraft {
  const { bt } = i
  const ddPct  = (bt.max_drawdown * 100).toFixed(1)
  const winPct = (bt.win_rate     * 100).toFixed(0)
  const pf     = bt.profit_factor != null ? bt.profit_factor.toFixed(2) : '—'
  const rr     = bt.avg_loss !== 0 ? Math.abs(bt.avg_win / bt.avg_loss).toFixed(2) : '—'

  const title  = `Backtest Breakdown — ${i.strategy_name} on ${i.symbol}`
  const summary =
    `${i.strategy_name} backtested on ${i.symbol} ${i.timeframe} (${i.window_label}). ` +
    `${bt.trades} trades · ${winPct}% win rate · PF ${pf} · R:R ${rr}.`

  const recsBlock = (i.recommendations && i.recommendations.length > 0)
    ? [
        '',
        '### What we\'d change',
        ...i.recommendations.slice(0, 3).map(r => `- **${r.title}** — ${r.rationale}`),
      ].join('\n')
    : ''

  const body_md = [
    `> **Backtest — not live trading.** Historical simulation on ${i.symbol} ${i.timeframe}, ${i.window_label}. No user account is referenced.`,
    '',
    `## ${i.strategy_name} on ${i.symbol}`,
    '',
    `### Executive Summary`,
    summary,
    '',
    `### Performance`,
    `- ${bt.trades} trades over ${i.window_label}`,
    `- Win rate: ${winPct}%`,
    `- Profit factor: ${pf}`,
    `- Average R:R: ${rr}`,
    `- Net return: ${bt.net_pnl_pct >= 0 ? '+' : ''}${bt.net_pnl_pct.toFixed(1)}%`,
    '',
    `### Risk`,
    `- Max drawdown: ${ddPct}%`,
    `- Sharpe: ${bt.sharpe != null ? bt.sharpe.toFixed(2) : '—'}`,
    '',
    `### Edge`,
    bt.profit_factor != null && bt.profit_factor >= 1.5
      ? 'Profit factor above 1.5 with positive expectancy indicates a measurable edge in this window.'
      : 'Edge is marginal — re-test on a different symbol or window before drawing conclusions.',
    recsBlock,
    '',
    `### Disclaimer`,
    'Past backtest performance does not predict future live results. Forward-test before sizing live capital.',
  ].filter(Boolean).join('\n')

  return {
    kind:         'backtest_breakdown',
    title,
    summary,
    body_md,
    tags:         ['backtest', i.symbol.toLowerCase(), i.timeframe],
    is_synthetic: true,
    disclaimer:   DISC.backtest,
    cta_text:     'Run your own backtest',
    cta_url:      '/backtest',
    provenance: {
      type:      'backtest_breakdown',
      symbol:    i.symbol,
      timeframe: i.timeframe,
      window:    i.window_label,
      generated_at: new Date().toISOString(),
    },
  }
}


// ─── Educational ──────────────────────────────────────────────────

export interface EducationalInput {
  topic:       string
  headline:    string
  body:        string                 // markdown
  reading_min: number
}

export function generateEducational(i: EducationalInput): GeneratedDraft {
  return {
    kind:         'educational',
    title:        i.headline,
    summary:      i.body.split('\n')[0]?.slice(0, 280) ?? '',
    body_md: [
      `_${i.reading_min} min read · ${i.topic}_`,
      '',
      i.body,
      '',
      '---',
      `_${DISC.educational}_`,
    ].join('\n'),
    tags:         ['educational', i.topic.toLowerCase().replace(/\s+/g, '_')],
    is_synthetic: false,
    disclaimer:   DISC.educational,
    cta_text:     'Try AlgoSphere',
    cta_url:      '/signup',
    provenance: {
      type:  'educational',
      topic: i.topic,
      generated_at: new Date().toISOString(),
    },
  }
}


// ─── Product Update ───────────────────────────────────────────────

export interface ProductUpdateInput {
  version:       string             // e.g. "R8" or "v1.5"
  headline:      string
  highlights:    string[]           // 3–8 bullet points
  link_label?:   string
  link_url?:     string
}

export function generateProductUpdate(i: ProductUpdateInput): GeneratedDraft {
  const title   = `Release ${i.version} — ${i.headline}`
  const summary = i.highlights.slice(0, 2).join(' · ').slice(0, 280)

  const body_md = [
    `## ${title}`,
    '',
    ...i.highlights.map(h => `- ${h}`),
    '',
    i.link_url && i.link_label ? `[${i.link_label}](${i.link_url})` : '',
  ].filter(Boolean).join('\n')

  return {
    kind:         'product_update',
    title,
    summary,
    body_md,
    tags:         ['product_update', 'release', i.version.toLowerCase()],
    is_synthetic: false,
    disclaimer:   DISC.product,
    cta_text:     'See what\'s new',
    cta_url:      i.link_url ?? '/overview',
    provenance: {
      type:    'product_update',
      version: i.version,
      generated_at: new Date().toISOString(),
    },
  }
}


// ─── Market Report ────────────────────────────────────────────────

export interface MarketReportInput {
  window_label: string                       // "2026-05-30" or "Week 22"
  cadence:      'daily' | 'weekly' | 'monthly'
  /** Symbol-level regime snapshots produced by the engine. */
  rows: Array<{
    symbol:   string
    regime:   string                           // e.g. 'trending', 'ranging'
    note?:    string                           // engine commentary
  }>
}

export function generateMarketReport(i: MarketReportInput): GeneratedDraft {
  const cadence = i.cadence.charAt(0).toUpperCase() + i.cadence.slice(1)
  const title   = `${cadence} Market Report — ${i.window_label}`
  const summary = `${i.rows.length} markets covered. Regime snapshot from the AlgoSphere intelligence engine.`

  const body_md = [
    `## ${title}`,
    '',
    summary,
    '',
    '| Symbol | Regime | Note |',
    '| --- | --- | --- |',
    ...i.rows.map(r => `| ${r.symbol} | ${r.regime} | ${r.note ?? '—'} |`),
    '',
    `_${DISC.market}_`,
  ].join('\n')

  return {
    kind:         'market_report',
    title,
    summary,
    body_md,
    tags:         ['market_report', i.cadence],
    is_synthetic: false,
    disclaimer:   DISC.market,
    cta_text:     'Open Market Intelligence',
    cta_url:      '/intelligence',
    provenance: {
      type:        'market_report',
      cadence:     i.cadence,
      window:      i.window_label,
      symbol_count: i.rows.length,
      generated_at: new Date().toISOString(),
    },
  }
}


// ─── Trade Breakdown (Phase 2) ──────────────────────────────────────
// Recap of a single closed trade. Pulls from real journal data — no
// fabrication. Honesty contract: requires complete trade data (entry
// AND exit) and lands as a DRAFT so the operator can decide per-trade
// whether to publish (privacy gate — auto_human trades are personal).

export interface TradeBreakdownInput {
  pair:           string
  direction:      'buy' | 'sell'
  entry_price:    number
  exit_price:     number
  lot_size:       number | null
  pnl:            number | null
  pips:           number | null
  duration_ms:    number | null
  trade_date:     string
  setup_tag?:     string | null
  session?:       string | null
  source:         string         // 'manual' | 'auto_human' | 'auto_engine'
  broker?:        string | null

  // From the matched journal_coach_evaluations row, if any.
  coach?: {
    quality_score:    number
    strategy_grade?:  string
    execution_grade?: number | null
    risk_grade?:      number | null
    timing_grade?:    number | null
    ai_insights?:     string[] | null
  }
}

function fmtDuration(ms: number | null): string {
  if (!ms || ms <= 0) return '—'
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 60)   return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24)     return `${hours}h ${minutes % 60}m`
  const days = Math.floor(hours / 24)
  return `${days}d ${hours % 24}h`
}

export function generateTradeBreakdown(i: TradeBreakdownInput): GeneratedDraft {
  // Require complete trade data — never publish a half-formed breakdown.
  if (i.entry_price == null || i.exit_price == null) {
    throw new Error('generateTradeBreakdown: entry_price and exit_price are both required')
  }

  const isWin    = (i.pnl ?? 0) >= 0
  const pnlStr   = i.pnl != null  ? `${i.pnl  >= 0 ? '+' : ''}${i.pnl.toFixed(2)}`  : '—'
  const pipsStr  = i.pips != null ? `${i.pips >= 0 ? '+' : ''}${i.pips.toFixed(1)}` : '—'
  const lotStr   = i.lot_size != null ? `${i.lot_size}` : '—'
  const durStr   = fmtDuration(i.duration_ms)
  const isAutoEngine = i.source === 'auto_engine'

  const title = isAutoEngine
    ? `Engine trade closed — ${i.pair} ${i.direction.toUpperCase()} ${pnlStr}`
    : `Trade breakdown — ${i.pair} ${i.direction.toUpperCase()}`

  const summary =
    `${i.pair} ${i.direction.toUpperCase()} closed ${isWin ? 'in profit' : 'at a loss'} ` +
    `(${pnlStr} · ${pipsStr} pips · held ${durStr}).`

  const lines: string[] = [
    `## ${i.pair} ${i.direction.toUpperCase()}`,
    '',
    '### Execution',
    `- Entry: ${i.entry_price}`,
    `- Exit:  ${i.exit_price}`,
    `- Size:  ${lotStr} lots`,
    `- Held:  ${durStr}`,
    `- Session: ${i.session ?? '—'}`,
    '',
    '### Result',
    `- P&L:  ${pnlStr}`,
    `- Pips: ${pipsStr}`,
  ]

  if (i.coach) {
    lines.push('', '### AlgoSphere Coach grade')
    lines.push(`- Overall: ${i.coach.quality_score}/100${i.coach.strategy_grade ? ` (${i.coach.strategy_grade})` : ''}`)
    if (i.coach.execution_grade != null) lines.push(`- Execution: ${i.coach.execution_grade}`)
    if (i.coach.risk_grade      != null) lines.push(`- Risk:      ${i.coach.risk_grade}`)
    if (i.coach.timing_grade    != null) lines.push(`- Timing:    ${i.coach.timing_grade}`)
    if (Array.isArray(i.coach.ai_insights) && i.coach.ai_insights.length > 0) {
      lines.push('', '### Process notes')
      for (const note of i.coach.ai_insights.slice(0, 3)) {
        lines.push(`- ${note}`)
      }
    }
  }

  // Honest source attribution. Engine-executed trades are platform
  // performance; broker-detected (auto_human) trades are a user's own —
  // the admin gate (output_status='draft') decides whether to publish.
  lines.push('')
  lines.push(
    isAutoEngine
      ? '_Engine-executed by AlgoSphere. Past performance is not predictive of future results._'
      : '_Trade detected from broker reality sync. Past performance is not predictive of future results._',
  )

  return {
    kind:         'trade_breakdown',
    title,
    summary,
    body_md:      lines.join('\n'),
    tags:         ['trade', i.pair, i.direction, isWin ? 'win' : 'loss', i.source].filter(Boolean) as string[],
    is_synthetic: false,
    disclaimer:   'Single-trade outcome. One trade is not a statistical claim. Not financial advice.',
    cta_text:     'See live signals on AlgoSphere',
    cta_url:      'https://algospherequant.com/signals',
    provenance: {
      type:         'trade_breakdown',
      pair:         i.pair,
      direction:    i.direction,
      source:       i.source,
      broker:       i.broker ?? null,
      trade_date:   i.trade_date,
      generated_at: new Date().toISOString(),
    },
  }
}


// ─── Coach Insights (Phase 3) ───────────────────────────────────────
// Aggregate "this week\'s coach themes" derived from the V3 coach
// evaluator output across all journal entries. Anonymised; no
// individual user surfaces.

export interface CoachInsightsInput {
  window_days:    number
  window_label:   string
  sample_size:    number
  avg_quality:    number
  avg_execution:  number
  avg_psychology: number
  avg_risk:       number
  avg_discipline: number
  avg_timing:     number
  top_themes:     Array<{ theme: string; count: number }>
  grade_mix:      Array<{ grade: string; count: number; pct: number }>
}

export function generateCoachInsights(i: CoachInsightsInput): GeneratedDraft {
  const gradeLine = i.grade_mix.slice(0, 4)
    .map((g) => `${g.grade} ${g.pct}%`).join(' · ')

  const themeLines = i.top_themes.length === 0
    ? ['_No standout themes this week._']
    : i.top_themes.map((t, idx) => `${idx + 1}. **${t.theme}** — flagged on ${t.count} trade${t.count === 1 ? '' : 's'}`)

  const body_md = [
    `> **Coach insights — ${i.window_label} · ${i.sample_size} graded trades.** Anonymised across all AlgoSphere users; no individual trades referenced.`,
    '',
    '## The week in process grades',
    '',
    `Grade mix: ${gradeLine}`,
    `Avg overall: **${i.avg_quality}/100**`,
    '',
    '## Five-axis means',
    `- Execution:  ${i.avg_execution}`,
    `- Psychology: ${i.avg_psychology}`,
    `- Risk:       ${i.avg_risk}`,
    `- Discipline: ${i.avg_discipline}`,
    `- Timing:     ${i.avg_timing}`,
    '',
    '## What the coach flagged most',
    ...themeLines,
    '',
    `_Sample: ${i.sample_size} coach evaluations across the past ${i.window_days} days. Means are arithmetic; themes are literal-match counts. Not financial advice._`,
  ].join('\n')

  return {
    kind:         'coach_insights',
    title:        `AlgoSphere Coach insights — ${i.window_label}`,
    summary:      `Across ${i.sample_size} graded trades the coach flagged: ${i.top_themes[0]?.theme ?? 'no standout themes'}. Avg overall: ${i.avg_quality}/100.`,
    body_md,
    tags:         ['coach', 'insights', 'psychology', 'weekly'],
    is_synthetic: false,
    disclaimer:   `Aggregate of ${i.sample_size} anonymised coach evaluations. Past performance does not predict future results.`,
    cta_text:     'See your own grade — AlgoSphere',
    cta_url:      'https://algospherequant.com/journal',
    provenance: {
      type:         'coach_insights',
      window_days:  i.window_days,
      sample_size:  i.sample_size,
      generated_at: new Date().toISOString(),
    },
  }
}


// ─── Broker Truth Analytics (Phase 4) ───────────────────────────────
// Aggregate of real broker-detected closed trades. NEVER references
// an individual user.

export interface BrokerTruthInput {
  window_days:        number
  window_label:       string
  sample_size:        number
  win_rate_pct:       number
  avg_duration_hours: number | null
  avg_pnl_usd:        number
  total_pnl_usd:      number
  most_traded:        Array<{ pair: string; count: number; pct: number }>
  most_active_session: { session: string; count: number; pct: number } | null
  brokers_represented: number
}

export function generateBrokerTruthAnalytics(i: BrokerTruthInput): GeneratedDraft {
  const pairLine = i.most_traded.length === 0
    ? '—'
    : i.most_traded.map((p) => `${p.pair} (${p.pct}%)`).join(' · ')

  const body_md = [
    `> **Broker-truth analytics — ${i.window_label} · ${i.sample_size} closed trades, anonymised.** Every figure derived from real broker reality sync data; no estimates.`,
    '',
    '## Trade activity',
    `- Closed trades:        **${i.sample_size}**`,
    `- Brokers represented:  ${i.brokers_represented}`,
    `- Win rate:             **${i.win_rate_pct}%**`,
    `- Avg hold:             ${i.avg_duration_hours != null ? `${i.avg_duration_hours}h` : '—'}`,
    '',
    '## P&L (aggregate, account currency)',
    `- Total realised:       ${i.total_pnl_usd >= 0 ? '+' : ''}${i.total_pnl_usd}`,
    `- Avg per trade:        ${i.avg_pnl_usd >= 0 ? '+' : ''}${i.avg_pnl_usd}`,
    '',
    '## Where the activity concentrated',
    `- Most traded pairs:    ${pairLine}`,
    `- Most active session:  ${i.most_active_session ? `${i.most_active_session.session} (${i.most_active_session.pct}%)` : '—'}`,
    '',
    `_Sample: ${i.sample_size} closed trades from the past ${i.window_days} days, sourced from broker history sync (MT5 \`HistoryDealsGet\`). Aggregate-only; no individual user identifiable._`,
  ].join('\n')

  return {
    kind:         'broker_truth',
    title:        `Broker-truth analytics — ${i.window_label}`,
    summary:      `${i.sample_size} closed trades across ${i.brokers_represented} broker${i.brokers_represented === 1 ? '' : 's'} · ${i.win_rate_pct}% win rate · ${i.total_pnl_usd >= 0 ? '+' : ''}${i.total_pnl_usd} total realised.`,
    body_md,
    tags:         ['broker-truth', 'analytics', 'weekly', 'transparency'],
    is_synthetic: false,
    disclaimer:   `Aggregate of ${i.sample_size} closed broker trades, anonymised. Past performance does not predict future results.`,
    cta_text:     'Connect your broker — AlgoSphere',
    cta_url:      'https://algospherequant.com/brokers',
    provenance: {
      type:         'broker_truth',
      window_days:  i.window_days,
      sample_size:  i.sample_size,
      generated_at: new Date().toISOString(),
    },
  }
}


// ─── Performance Transparency (Phase 5) ─────────────────────────────
// AlgoSphere\'s OWN signal performance, not user performance. Refuses
// to publish outcome-based metrics below the sample threshold.

export interface PerformanceTransparencyInput {
  window_days:           number
  window_label:          string
  sample_size:           number
  signals_published:     number
  signals_settled:       number
  signals_in_flight:     number
  win_rate_pct:          number | null
  avg_r_multiple:        number | null
  profit_factor:         number | null
  expectancy_r:          number | null
  by_pair:               Array<{ pair: string; count: number; pct: number }>
  confidence_disclaimer: string
}

export function generatePerformanceTransparency(i: PerformanceTransparencyInput): GeneratedDraft {
  const pairLine = i.by_pair.length === 0
    ? '—'
    : i.by_pair.slice(0, 4).map((p) => `${p.pair} (${p.count})`).join(' · ')

  const fmt = (v: number | null): string => v == null ? 'N/A (insufficient sample)' : String(v)

  const body_md = [
    `> **AlgoSphere signal performance — ${i.window_label}.** Engine-generated signals only. No user trades, no extrapolation.`,
    '',
    '## Signal volume',
    `- Published:    **${i.signals_published}**`,
    `- Settled:      ${i.signals_settled}`,
    `- In-flight:    ${i.signals_in_flight}`,
    '',
    '## Outcomes (settled signals)',
    `- Win rate:     ${i.win_rate_pct == null ? 'N/A' : `**${i.win_rate_pct}%**`}`,
    `- Avg R:R (planned): ${fmt(i.avg_r_multiple)}`,
    `- Profit factor (pips): ${fmt(i.profit_factor)}`,
    `- Expectancy (pips/signal): ${fmt(i.expectancy_r)}`,
    '',
    '## Pair coverage',
    `- Top pairs by signal count: ${pairLine}`,
    '',
    `_${i.confidence_disclaimer} Past performance does not predict future results._`,
  ].join('\n')

  return {
    kind:         'performance_transparency',
    title:        `AlgoSphere performance — ${i.window_label}`,
    summary:      `${i.signals_published} signals published · ${i.signals_settled} settled${i.win_rate_pct != null ? ` · ${i.win_rate_pct}% win rate` : ' · win rate suppressed (insufficient sample)'}.`,
    body_md,
    tags:         ['performance', 'transparency', 'weekly', 'signals'],
    is_synthetic: false,
    disclaimer:   `${i.signals_settled} settled signals across the past ${i.window_days} days. ${i.confidence_disclaimer}`,
    cta_text:     'See the live signal feed',
    cta_url:      'https://algospherequant.com/signals',
    provenance: {
      type:              'performance_transparency',
      window_days:       i.window_days,
      sample_size:       i.sample_size,
      signals_settled:   i.signals_settled,
      generated_at:      new Date().toISOString(),
    },
  }
}
