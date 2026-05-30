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
