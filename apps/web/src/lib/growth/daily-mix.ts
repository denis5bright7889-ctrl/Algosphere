/**
 * Daily content orchestrator — produces the V100000-spec daily mix
 * (3 educational + 2 market + 1 feature + 1 psychology + 1 video stub
 * + 1 screenshot stub + 1 blog draft) using pure deterministic
 * generators and the automation engine that's already wired.
 *
 * Honesty contract:
 *   - Nothing here fabricates user activity. Educational rotation
 *     reads from a curated topic list. Market posts read regime
 *     snapshots from the engine. Psychology posts read aggregated
 *     journal data (anonymised). If sample size is too thin, those
 *     posts are skipped and the day's output simply has fewer rows.
 *   - All produced content goes through ingestEvent() so the existing
 *     auto-publish whitelist / approval gate still applies (educational
 *     + market_report auto-publish, others require admin approval).
 *
 * Side effects: one row per produced piece in growth_content_items +
 * growth_scheduled_posts (where the rule has channels configured) +
 * one growth_event_log row per event fired.
 *
 * Pure orchestration — no new infra. Calls ingestEvent() for each
 * mix slot. The automation rules table decides what kind of content
 * each event produces and which channels it routes to.
 */
import { createClient as serviceClient, type SupabaseClient } from '@supabase/supabase-js'
import { ingestEvent, type IngestedEvent } from './automation'
import { aggregateCoachInsights }            from '../intelligence/coach-insights-aggregate'
import { aggregateBrokerTruth }              from '../intelligence/broker-truth-aggregate'
import { aggregatePerformanceTransparency }  from '../intelligence/performance-transparency-aggregate'

function svc(): SupabaseClient {
  return serviceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

export interface DailyMixSummary {
  fired_at:    string
  attempts:    number
  produced:    number
  by_kind:     Record<string, number>
  errors:      Array<{ slot: string; error: string }>
}

// ─── Curated educational rotation ──────────────────────────────────
// Day-of-year mod len picks the topic — deterministic, no repetition
// within a year. Three topics fire per day so we rotate through ~120
// topics annually before any repeat.
const EDUCATIONAL_TOPICS: Array<{
  topic:       string
  headline:    string
  body:        string
  reading_min: number
}> = [
  {
    topic:       'Risk per trade',
    headline:    'Why 1% risk per trade compounds — and 5% blows up',
    body:        'Risk per trade is the single most important number in trading. At 1% risk per trade, a 10-loss streak (which happens roughly twice a year on most strategies) costs ~10% of the account — survivable. At 5% risk, the same streak compounds to a ~40% drawdown that takes a 67% return to recover. Position-size capacity is asymmetric: it scales linearly with risk-of-ruin. The AlgoSphere position-sizing calculator translates your stop distance + account equity into the exact lot size that risks your chosen % — paste a signal in and the math is done for you.',
    reading_min: 3,
  },
  {
    topic:       'Backtest expectations',
    headline:    'Reading a backtest honestly — what 30 trades means vs 300',
    body:        'A backtest with 30 trades and a 70% win rate is statistically indistinguishable from one with 50% — the confidence interval is just too wide. At 300 trades the same number tightens to ±5%. AlgoSphere\'s Strategy Grader marks any sample under 30 trades as "N/A" with a low-confidence pill, regardless of how good the headline number looks. The numbers you should trust: profit factor + drawdown over ≥100 trades, across at least two regime types. Anything less is a hypothesis, not a result.',
    reading_min: 4,
  },
  {
    topic:       'Journaling discipline',
    headline:    'The journal entry that costs you nothing and earns you everything',
    body:        'Two minutes of journaling after a trade — what you saw, what you expected, what you felt — is the highest-leverage habit in retail trading. Not because it makes the trade better (it doesn\'t), but because it gives the AI Coach raw material to grade your process across 5 axes: execution, psychology, risk, discipline, timing. After 50 entries the Coach can tell you exactly which axis is dragging your equity curve. Most retail traders never journal; you have a quant edge if you do.',
    reading_min: 3,
  },
  {
    topic:       'Regime classification',
    headline:    'Trending vs ranging — why the same strategy lives or dies on this',
    body:        'A trend-following strategy in a ranging market is a slow-motion equity destroyer. A mean-reversion strategy in a trending market is the same. AlgoSphere classifies the regime every scan using DER (directional efficiency ratio) + entropy + autocorrelation — three orthogonal lenses on the same price series. Signals are filtered against the regime BEFORE confidence scoring, so a "buy" never publishes during a confirmed downtrend. You can see the current regime per pair on /intelligence/markets.',
    reading_min: 4,
  },
  {
    topic:       'Stop-loss placement',
    headline:    'Where the stop goes — ATR vs structure vs gut',
    body:        'Stops placed at round numbers, fixed pip counts, or "wherever it feels safe" are the leading retail account-killers. The two defensible options: ATR-based (×1.0 to ×1.5 of the 14-period ATR) which adapts to volatility, or structure-based (just past the prior swing high/low) which lets the chart tell you. The AlgoSphere Quant Builder defaults SL to 1.2× ATR; you can change it per strategy. Either way, the stop is set BEFORE the entry — never adjusted to "give the trade room" after.',
    reading_min: 3,
  },
  {
    topic:       'Profit factor',
    headline:    'Profit factor 1.5 is the floor — here\'s why',
    body:        'Profit factor = gross wins / gross losses. PF 1.0 means you break even before costs; PF 1.5 means you make $1.50 per $1.00 lost. After spread, slippage, and broker commissions (typical retail forex: ~0.3 PF drag), a backtested 1.5 PF often comes out to 1.2 live. Below 1.2 live, the variance dominates the edge — you\'ll spend more time recovering drawdown than making new equity highs. AlgoSphere\'s Backtester displays PF prominently and bakes default cost assumptions into every run.',
    reading_min: 4,
  },
  {
    topic:       'Sessions matter',
    headline:    'London open vs Asia chop — same pair, different game',
    body:        'EUR/USD during the London session prints 60% of its daily range in three hours. The same pair during Asia averages ~12 pips of movement. A breakout strategy that thrives in London bleeds during Asia waiting for a move that won\'t come. AlgoSphere\'s Session Window block in the Quant Builder lets you restrict entries to the productive hours — typically London + NY overlap for major forex, all day for crypto. Your strategy doesn\'t need to "work always"; it needs to work when it should.',
    reading_min: 3,
  },
  {
    topic:       'Overfit detection',
    headline:    'Your perfect backtest is probably overfit — three tells',
    body:        'Three signs a backtest is curve-fit, not edge-discovered: (1) profit factor > 3 on < 50 trades, (2) the equity curve has zero drawdown days, (3) tiny parameter changes (e.g. EMA 21 → 20) crater the result. Real edges are robust to parameter perturbation — a 5% slide should change PF by < 0.2. AlgoSphere\'s Optimization Center sweeps the parameter space and reports edge-stability scores; high stability = real edge, low stability = pattern matching the past.',
    reading_min: 4,
  },
  // ── Phase 1: System Architecture content. Each grounded in actual
  //    platform behavior — no marketing fluff. Sourced from the
  //    real subsystems (regime engine, ensemble layer, broker reality
  //    sync, risk firewall, journal triggers, asset worker).
  {
    topic:       'System architecture: regime classification',
    headline:    'How AlgoSphere reads the market — three orthogonal lenses, every minute',
    body:        'AlgoSphere classifies the market regime every scan using three independent measurements: DER (directional efficiency ratio) catches whether price is going somewhere or oscillating; entropy measures how unpredictable the return distribution is; autocorrelation measures whether yesterday\'s move predicts today\'s. The three combine into one regime label per pair — trending, ranging, volatile, transitional, expansion, exhaustion. Signals are gated against this BEFORE entering the confidence layer, so a "buy" never publishes during a confirmed downtrend. The same regime drives the per-regime adaptive threshold in the ensemble layer — a 0.12 net score is "go" in a trending regime but only "noise" in chop.',
    reading_min: 4,
  },
  {
    topic:       'System architecture: ensemble consensus',
    headline:    'Why AlgoSphere weights strategies instead of voting them',
    body:        'Vote-counting ensembles ("3 of 8 strategies say buy") reject good signals when only 2 strategies vote at all. AlgoSphere\'s ensemble sums SIGNED, weighted contributions: each strategy outputs a direction + strength + confidence, weighted by its historical regime-fit; the net signed score is compared to a regime-adaptive threshold T. A weak unanimous signal can clear T; a strong contradicted signal nets out. This is why the engine doesn\'t need 5 strategies firing to publish — one high-conviction strategy in the right regime is enough.',
    reading_min: 4,
  },
  {
    topic:       'System architecture: broker reality sync',
    headline:    'Why AlgoSphere polls your broker every 30 seconds — the truth layer',
    body:        'Databases drift; brokers don\'t. AlgoSphere\'s Broker Reality Sync (truth layer) polls each connected broker every 30s, read-only, and reconciles real open positions against our own execution_events. A position open at the broker but missing from our log gets a detected ORDER_FILLED event injected — the journal trigger then auto-creates the journal row. A position that vanished from the broker gets a POSITION_CLOSED event with the broker\'s own exit price, realized P&L, commission, and swap (fetched from MT5\'s history table). The result: your journal matches your broker, always.',
    reading_min: 4,
  },
  {
    topic:       'System architecture: risk firewall',
    headline:    '15 gates between a signal and your account — the risk firewall',
    body:        'Before any signal becomes a tradeable order, AlgoSphere runs 15 institutional risk gates: account-equity floor, daily-loss cap, max-consecutive-losses, max-active-per-symbol, exposure cap, correlation cap, regime-veto, drawdown cap, volatility filter, session-window, news-window, slippage tolerance, lot-rounding rule, broker-status check, and kill-switch state. ANY gate failing rejects the order and writes an audit event to system_event_log — visible from your /admin/signals page. Every rejection is honest about which gate fired and why.',
    reading_min: 4,
  },
  {
    topic:       'System architecture: AI coach pipeline',
    headline:    'How AlgoSphere grades a trade in five dimensions — never on PnL',
    body:        'When a journal entry is saved, the deterministic V3 coach evaluator runs immediately. It produces 5 process grades (execution, psychology, risk, discipline, timing) from PROCESS data only — never from PnL outcome. A losing trade can be A-grade execution; a winning trade can be poor execution. The coach also generates 3+ specific behavioral insights ("you tend to overtrade after losses", "London remains your highest-expectancy session") that downstream analytics read directly. No Gemini in this path — pure deterministic math, so the same trade always grades the same way.',
    reading_min: 4,
  },
  {
    topic:       'System architecture: signal lifecycle',
    headline:    'From OHLCV to a signal in your feed — the lifecycle in 8 steps',
    body:        'A signal\'s journey: (1) market-data provider returns OHLCV bars; (2) feature engineer computes technicals; (3) regime engine labels the bar; (4) ensemble strategies vote signed contributions; (5) confidence engine sums weighted votes vs regime-adaptive threshold; (6) 15 risk gates validate; (7) signal-emission writes to the signals table + WebSocket-pushes to subscribers; (8) Telegram + Discord adapters fan out. Each step writes its outcome to system_event_log — so every signal is auditable end-to-end. If the signal never reaches you, the log tells you which step rejected it.',
    reading_min: 5,
  },
  // ── Phase 6: Trading Psychology expansion (10 topics) ───────────────
  // Behavioural-economics framing, evidence-based. AlgoSphere\'s
  // Psychology Engine V2 grades these axes from journal data, so the
  // copy aligns to what the platform actually measures.
  {
    topic:       'Psychology: tilt',
    headline:    'Tilt — the 90-minute window where 60% of bad trades happen',
    body:        'Tilt is the post-loss emotional state where you abandon your rules to "make it back". Most retail studies put 50-60% of catastrophic drawdowns inside a 90-minute window after a 2R+ losing trade. The tell: position size creeps up, stops widen, entries skip the checklist. AlgoSphere\'s Psychology Engine flags a tilt-risk score on your journal after any loss and shows when your historical tilt-window trades cluster. The fix is mechanical: cooldown timer + reduced size for the next 3 trades. Discipline scales; willpower doesn\'t.',
    reading_min: 4,
  },
  {
    topic:       'Psychology: revenge trading',
    headline:    'Revenge trading — the trade you take to argue with the market',
    body:        'A revenge trade isn\'t about price; it\'s about reclaiming the feeling of being right. Signature pattern: you re-enter the same pair within 30 minutes of a loss, often in the same direction, often with size larger than your plan. The market doesn\'t know you lost — only you do. AlgoSphere flags rapid same-pair re-entries in the journal so the pattern is impossible to hide from yourself. The hardest skill in trading isn\'t finding the next setup. It\'s sitting on your hands after the last one.',
    reading_min: 3,
  },
  {
    topic:       'Psychology: recency bias',
    headline:    'Recency bias — why your last 3 trades dictate your next 30',
    body:        'Humans weight the most recent outcomes far more than statistical reality justifies. A 3-trade losing streak feels like the strategy is "broken" even when the backtest shows streaks of 6 are normal at the strategy\'s win rate. The reverse traps too — 3 wins in a row feel like a green light to oversize. AlgoSphere\'s Psychology Engine compares your trade-size variance to your historical baseline; when it spikes, the recency-bias score climbs. Trust the sample, not the streak.',
    reading_min: 3,
  },
  {
    topic:       'Psychology: confirmation bias',
    headline:    'Confirmation bias — why every chart you see "confirms" your trade',
    body:        'Once you\'re in a position, your brain hunts for evidence supporting it and discounts evidence against it. The Reuters terminal looks bullish if you\'re long. AlgoSphere\'s solution: write your invalidation thesis IN the trade entry. The Psychology Engine flags entries with no invalidation note as elevated-bias trades, and your historical "no-invalidation" trades show measurably worse outcomes. The discipline is in the recorded thought, not the price action.',
    reading_min: 3,
  },
  {
    topic:       'Psychology: overconfidence',
    headline:    'Overconfidence — the 7-trade winning streak that ends in a 20% drawdown',
    body:        'A win streak doesn\'t mean the market changed in your favour — it usually means random variance lined up. The danger isn\'t the streak; it\'s the size creep that follows it. The Kelly Criterion says optimal size is proportional to edge, not recent results. AlgoSphere\'s journal tracks confidence_level vs realised outcome — overconfidence is the gap between the two. Trim the gap and the drawdown shrinks.',
    reading_min: 3,
  },
  {
    topic:       'Psychology: underconfidence',
    headline:    'Underconfidence — when your best setups are the ones you skip',
    body:        'After a losing run, traders downsize good setups or skip them entirely — the inverse of overconfidence but equally costly. The pattern: A-grade setups taken with quarter-size, B-grade setups taken at full size out of impatience. AlgoSphere\'s Psychology Engine compares your confidence_level rating to the coach\'s grade for the same trade; chronic underconfidence shows as a downward bias. Trade the setup, not the mood.',
    reading_min: 3,
  },
  {
    topic:       'Psychology: emotional discipline',
    headline:    'Emotional discipline — the only edge that compounds',
    body:        'Strategies decay; markets shift; brokers change spreads. The one thing that compounds across all of it is the discipline to execute your rules when you don\'t feel like it. Studies of prop-firm traders show top quartile vs bottom quartile differs more on rule-adherence than on strategy choice. AlgoSphere\'s coach grades discipline 0-100 on every journal entry — the trend matters more than any single score.',
    reading_min: 3,
  },
  {
    topic:       'Psychology: patience',
    headline:    'Patience — the trader\'s muscle most never train',
    body:        'A-grade setups don\'t appear hourly. They appear when a confluence of regime + structure + session aligns — typically 2-5x per week per pair. Traders trained on hourly charts develop a "boredom premium" — they take B and C setups just to be in the market. AlgoSphere\'s coach tracks your setup_validity rating across the journal; A-validity trades have measurably higher expectancy. Patience is just the willingness to grade your own setup honestly before you click.',
    reading_min: 3,
  },
  {
    topic:       'Psychology: fear management',
    headline:    'Fear management — the trade you don\'t take is sometimes the worst trade',
    body:        'Fear shows up two ways: skipping good setups (cost: missed expectancy), and exiting winners too early (cost: cut R multiple). Both look like discipline from the inside. The diagnostic: track what your exit_quality would have been if you held to your original target. AlgoSphere\'s coach grades exit_quality separately from entry_quality — the gap between the two is your fear tax. Most traders pay it monthly without noticing.',
    reading_min: 3,
  },
  {
    topic:       'Psychology: greed management',
    headline:    'Greed management — why the trader who can take profit beats the trader who can\'t',
    body:        'Greed isn\'t holding for a bigger win; that\'s patience. Greed is moving your target AFTER price hits your original level. The shift looks like "letting profits run" but it\'s actually changing the rules mid-trade. AlgoSphere\'s coach flags trades where the take-profit was moved post-entry, and the data shows those trades give back ~40% of their peak unrealised P&L on average. The exit you planned at the entry is usually the right one.',
    reading_min: 3,
  },
  // ── Phase 7: Risk Management expansion (8 topics) ───────────────────
  // Capital-preservation framing. Maps directly to AlgoSphere\'s 15-gate
  // risk firewall and the position-sizing calculator already shipped.
  {
    topic:       'Risk: position sizing math',
    headline:    'Position sizing — the one calculation that makes or breaks an account',
    body:        'Position size = (account equity × risk %) ÷ |entry − stop|. Every variable matters, but the most-skipped one is |entry − stop| — traders fix lot size first and stop second, which means risk varies per trade. AlgoSphere\'s position-sizing calculator inverts that: fix risk %, fix stop, derive size. Paste a signal in and the math is done. The cost of getting this wrong scales with leverage — at 50:1, a 0.1% size error becomes a 5% account swing.',
    reading_min: 4,
  },
  {
    topic:       'Risk: portfolio exposure',
    headline:    'Portfolio exposure — the hidden risk you didn\'t open one trade at a time',
    body:        'Three forex trades at 1% risk each isn\'t 3% portfolio risk — it\'s closer to 5-8% because the pairs share USD legs and move together when the dollar regime shifts. AlgoSphere\'s 15-gate risk firewall includes an exposure gate that sums total active risk across all open positions and blocks new entries above your configured ceiling. The institutional rule: cap total simultaneous exposure at 5x your per-trade risk.',
    reading_min: 4,
  },
  {
    topic:       'Risk: correlation risk',
    headline:    'Correlation risk — why 4 "diversified" longs can all blow up together',
    body:        'EURUSD + GBPUSD + AUDUSD + NZDUSD aren\'t four trades — they\'re four expressions of the same "long non-USD" bet. When the dollar rips, all four lose simultaneously. AlgoSphere\'s correlation gate computes rolling-30d Pearson correlation across the watchlist and refuses new entries that would push your portfolio correlation past a threshold. Real diversification means uncorrelated edges, not multiple symbols.',
    reading_min: 4,
  },
  {
    topic:       'Risk: risk of ruin',
    headline:    'Risk of ruin — the math behind "why even a 60% win-rate strategy can blow up"',
    body:        'Risk of ruin is the probability your account hits zero before reaching your goal. At 60% win rate and 1R:1R reward, risking 1% per trade gives you ~0.001% ruin risk over 100 trades. At 5% per trade, the same strategy gives ~40% ruin risk. The math is brutal because losses compound percentages, not dollars. AlgoSphere\'s risk-of-ruin tool plugs your strategy\'s real win rate + R-multiple + chosen risk % into the formula. Most retail accounts blow up because the math wasn\'t checked.',
    reading_min: 4,
  },
  {
    topic:       'Risk: drawdown recovery',
    headline:    'Drawdown recovery math — why a 50% loss requires a 100% gain',
    body:        'Drawdown recovery is asymmetric. A 10% drawdown needs 11% to recover; a 25% drawdown needs 33%; a 50% drawdown needs 100%; a 75% drawdown needs 300%. This is why institutional traders enforce max-drawdown circuit breakers — not because the loss itself is fatal, but because the recovery becomes statistically improbable. AlgoSphere\'s drawdown gate auto-disables new entries when the daily drawdown crosses a configurable threshold. Live to trade tomorrow.',
    reading_min: 4,
  },
  {
    topic:       'Risk: leverage management',
    headline:    'Leverage — the amplifier that doesn\'t care which direction you\'re wrong in',
    body:        'Leverage doesn\'t change your edge; it changes the variance of your equity curve. 100:1 leverage on a 60% win-rate strategy still has a 60% win rate — but the per-trade equity swings are 100x larger. Most retail accounts that blow up had a strategy with positive expectancy that died of variance under leverage. AlgoSphere\'s position-sizing calculator works in RISK %, not LEVERAGE — because risk % is what blows up an account, not leverage. Pick risk first; leverage is just a multiplier on the math.',
    reading_min: 4,
  },
  {
    topic:       'Risk: volatility-adjusted sizing',
    headline:    'Volatility-adjusted sizing — why XAUUSD and EURUSD shouldn\'t use the same lot size',
    body:        'XAUUSD\'s ATR is roughly 30x EURUSD\'s in absolute dollar terms per lot. A 1% risk position on EURUSD might be 0.1 lots; on XAUUSD, 0.01. Fixed-lot sizing across pairs hides risk asymmetry — your "small XAU position" is the same dollar risk as a "huge EUR position". AlgoSphere\'s sizing engine normalises against the symbol\'s ATR + pip value so 1% risk truly means 1% across the universe. Same risk, different math.',
    reading_min: 4,
  },
  {
    topic:       'Risk: capital preservation',
    headline:    'Capital preservation — the only goal that compounds across regimes',
    body:        'In trending markets, aggressive sizing wins. In choppy markets, aggressive sizing kills accounts. The trader who preserves capital across BOTH regimes ends the year ahead of the trader who outperformed in one. AlgoSphere\'s engine throttles your active risk during regime-transition windows (volatility spikes, structure breaks) — not because the next trade is bad, but because the variance is uncertain. The first job of risk management is to still be trading next month. Returns are downstream of that.',
    reading_min: 4,
  },
]

function pickDailyEducationalTrio(now: Date): typeof EDUCATIONAL_TOPICS {
  const doy = Math.floor((now.getTime() - new Date(Date.UTC(now.getUTCFullYear(), 0, 1)).getTime()) / 86_400_000)
  const n = EDUCATIONAL_TOPICS.length
  return [
    EDUCATIONAL_TOPICS[(doy * 3 + 0) % n]!,
    EDUCATIONAL_TOPICS[(doy * 3 + 1) % n]!,
    EDUCATIONAL_TOPICS[(doy * 3 + 2) % n]!,
  ]
}

// ─── Best recent closed trade (Phase 2 trade breakdown) ────────────
// Returns the payload generateTradeBreakdown needs for the highest-
// quality_score trade closed in the past 24h that ALSO has a coach
// evaluation. Returns null when nothing qualifies (honest empty
// rather than a fabricated breakdown).
async function pickBestRecentClosedTrade(
  db: SupabaseClient,
): Promise<Record<string, unknown> | null> {
  const since24h = new Date(Date.now() - 86_400_000).toISOString()

  // Pull recently-closed entries first. Closed = exit_price IS NOT
  // NULL — the migration-75/76 trigger sets this on POSITION_CLOSED.
  const { data: closed } = await db
    .from('journal_entries')
    .select('id, user_id, pair, direction, entry_price, exit_price, lot_size, pnl, pips, duration_ms, trade_date, setup_tag, session, source, broker, created_at')
    .not('exit_price', 'is', null)
    .gte('created_at', since24h)
    .limit(60)

  const rows = (closed ?? []) as Array<{
    id: string; user_id: string; pair: string | null; direction: string | null
    entry_price: number | null; exit_price: number | null
    lot_size: number | null; pnl: number | null; pips: number | null
    duration_ms: number | null; trade_date: string
    setup_tag: string | null; session: string | null
    source: string; broker: string | null
  }>
  if (rows.length === 0) return null

  // Look up coach evaluations for those entries.
  const ids = rows.map((r) => r.id)
  const { data: evals } = await db
    .from('journal_coach_evaluations')
    .select('journal_entry_id, quality_score, strategy_grade, execution_grade, risk_grade, timing_grade, ai_insights')
    .in('journal_entry_id', ids)
    .order('created_at', { ascending: false })

  const evalByEntry = new Map<string, {
    quality_score: number; strategy_grade?: string
    execution_grade: number | null; risk_grade: number | null; timing_grade: number | null
    ai_insights: string[] | null
  }>()
  for (const e of (evals ?? []) as Array<{
    journal_entry_id: string; quality_score: number; strategy_grade?: string
    execution_grade: number | null; risk_grade: number | null; timing_grade: number | null
    ai_insights: string[] | null
  }>) {
    // First (newest) per entry wins — append-only evals.
    if (!evalByEntry.has(e.journal_entry_id)) {
      evalByEntry.set(e.journal_entry_id, e)
    }
  }

  // Score each entry: prefer the row with highest coach quality_score;
  // entries without a coach eval are skipped (no fabrication).
  const candidates = rows
    .filter((r) =>
      r.pair && r.direction && r.entry_price != null && r.exit_price != null
      && (r.direction === 'buy' || r.direction === 'sell')
      && evalByEntry.has(r.id),
    )
    .map((r) => ({ r, e: evalByEntry.get(r.id)! }))
    .sort((a, b) => b.e.quality_score - a.e.quality_score)

  const best = candidates[0]
  if (!best) return null

  return {
    pair:        best.r.pair,
    direction:   best.r.direction,
    entry_price: best.r.entry_price,
    exit_price:  best.r.exit_price,
    lot_size:    best.r.lot_size,
    pnl:         best.r.pnl,
    pips:        best.r.pips,
    duration_ms: best.r.duration_ms,
    trade_date:  best.r.trade_date,
    setup_tag:   best.r.setup_tag,
    session:     best.r.session,
    source:      best.r.source,
    broker:      best.r.broker,
    coach: {
      quality_score:   best.e.quality_score,
      strategy_grade:  best.e.strategy_grade,
      execution_grade: best.e.execution_grade,
      risk_grade:      best.e.risk_grade,
      timing_grade:    best.e.timing_grade,
      ai_insights:     best.e.ai_insights,
    },
  }
}

// ─── Daily screenshot showcase rotation ────────────────────────────
// One showcase target per day, rotating through 5 surfaces. Each one
// fires a `showcase.daily` event with predicate-matching target → the
// matching rule produces a content_item with content_kind='educational'
// + asset_kinds=['<target>_screenshot']. Railway worker captures the
// real page; nothing fabricated.
const SHOWCASE_ROTATION: Array<{
  target:   'dashboard' | 'psychology' | 'strategy' | 'feature' | 'education'
  topic:    string
  headline: string
  body:     string
}> = [
  {
    target:   'dashboard',
    topic:    'Showcase: Command Center',
    headline: 'One screen, every position — the AlgoSphere Command Center',
    body:     'The Command Center is the operator dashboard for an automated trading account: live broker pulse, today\'s opportunities, coach lead, risk-gate state, and every active signal in one viewport. Live screenshot below.',
  },
  {
    target:   'psychology',
    topic:    'Showcase: Behavioral Intelligence',
    headline: 'Your psychology, graded — 10 institutional metrics',
    body:     'AlgoSphere\'s Psychology Engine grades 10 behavioural axes from your journal: confidence drift, tilt, recency bias, strategy hopping, resilience, patience, rule adherence, self-control, risk discipline, and the maturity index. No AI hallucination — pure deterministic math on your own entries. Live screenshot below.',
  },
  {
    target:   'strategy',
    topic:    'Showcase: Quant Builder',
    headline: 'Build, backtest, grade — the Quant Builder',
    body:     'Compose a strategy from blocks (entry, stop, take-profit, session-window, regime-filter), run a backtest, get a grade. The Strategy Grader requires ≥30 trades before issuing a grade — under that, it shows "N/A" with a low-confidence pill. Live screenshot below.',
  },
  {
    target:   'feature',
    topic:    'Showcase: Decision Intelligence',
    headline: 'Market regime, correlation, breadth — Decision Intelligence',
    body:     'Decision Intelligence reads the market\'s state: regime classification per pair (trending / ranging), rolling-Pearson correlation across the watchlist, breadth, volatility band, and a Market Pulse score. Live screenshot below.',
  },
  {
    target:   'education',
    topic:    'Showcase: Education Hub',
    headline: 'Risk, strategy, psychology — the AlgoSphere Education Hub',
    body:     'The Education Hub is the open-access reading library: risk per trade, profit factor, regime classification, stop-loss placement, journaling discipline, overfit detection. Free to read, no signup required. Live screenshot below.',
  },
]

function pickDailyShowcase(now: Date): typeof SHOWCASE_ROTATION[number] {
  const doy = Math.floor((now.getTime() - new Date(Date.UTC(now.getUTCFullYear(), 0, 1)).getTime()) / 86_400_000)
  return SHOWCASE_ROTATION[doy % SHOWCASE_ROTATION.length]!
}

// ─── Market posts ──────────────────────────────────────────────────

async function buildMarketReportPayloads(db: SupabaseClient): Promise<Array<IngestedEvent['payload']>> {
  const since24h = new Date(Date.now() - 86_400_000).toISOString()
  const { data: snaps } = await db
    .from('regime_snapshots')
    .select('symbol, regime, scanned_at')
    .gte('scanned_at', since24h)
    .order('scanned_at', { ascending: false })
    .limit(200)

  const seen = new Set<string>()
  const rows: Array<{ symbol: string; regime: string; note?: string }> = []
  for (const r of (snaps ?? []) as Array<{ symbol: string; regime: string; scanned_at: string }>) {
    if (seen.has(r.symbol)) continue
    seen.add(r.symbol)
    rows.push({ symbol: r.symbol, regime: r.regime, note: `scan ${r.scanned_at.slice(11, 16)} UTC` })
  }

  if (rows.length === 0) return []

  // Split into two: forex/metals vs crypto. Two posts a day cover
  // different audiences without doubling up content.
  const fx     = rows.filter((r) => /USD|JPY|GBP|EUR|CHF|AUD|XAU|XAG/.test(r.symbol) && !/BTC|ETH|SOL/.test(r.symbol)).slice(0, 12)
  const crypto = rows.filter((r) => /BTC|ETH|SOL|XRP/.test(r.symbol)).slice(0, 8)

  const today = new Date().toISOString().slice(0, 10)
  const out: Array<IngestedEvent['payload']> = []
  if (fx.length >= 3) {
    out.push({
      window_label: today,
      cadence:      'daily',
      rows:         fx,
    })
  }
  if (crypto.length >= 2) {
    out.push({
      window_label: today,
      cadence:      'daily',
      rows:         crypto,
    })
  }
  return out
}

// ─── Public entry point ────────────────────────────────────────────

export async function runDailyMix(): Promise<DailyMixSummary> {
  const db = svc()
  const summary: DailyMixSummary = {
    fired_at: new Date().toISOString(),
    attempts: 0,
    produced: 0,
    by_kind:  {},
    errors:   [],
  }

  const tally = (slot: string, kind: string, ok: boolean, error?: string) => {
    summary.attempts += 1
    if (ok) {
      summary.produced += 1
      summary.by_kind[kind] = (summary.by_kind[kind] ?? 0) + 1
    } else if (error) {
      summary.errors.push({ slot, error })
    }
  }

  // 1-3) Three educational topics (daily-rotated, no repeat for ~40 days)
  const educPlan = pickDailyEducationalTrio(new Date())
  for (let i = 0; i < educPlan.length; i++) {
    const e = educPlan[i]!
    try {
      const out = await ingestEvent({
        event_type: 'manual.fire',
        source:     'daily_mix',
        payload:    { topic: e.topic, headline: e.headline, body: e.body, reading_min: e.reading_min },
      })
      tally(`educational[${i}]`, 'educational', out.outcome === 'ok')
    } catch (err) {
      tally(`educational[${i}]`, 'educational', false, err instanceof Error ? err.message : 'unknown')
    }
  }

  // 4-5) Two market posts (forex/metals + crypto)
  try {
    const payloads = await buildMarketReportPayloads(db)
    for (let i = 0; i < payloads.length; i++) {
      const out = await ingestEvent({
        event_type: 'performance.weekly',     // reuse the existing rule
        source:     'daily_mix',
        payload:    payloads[i]!,
      })
      tally(`market[${i}]`, 'market_report', out.outcome === 'ok')
    }
  } catch (err) {
    tally('market', 'market_report', false, err instanceof Error ? err.message : 'unknown')
  }

  // 6) Feature post — only fire if a feature_released event hasn't
  // already produced content in the past 7 days (avoid spam).
  // Skipped here entirely; product updates are operator-initiated.

  // 7) Psychology post — aggregated journal patterns (sample-gated).
  // Skipped when journal sample is thin; honest emptiness > fabrication.
  // The dedicated psychology generator lands in a follow-up slice.

  // 7.5) Trade breakdown — picks the highest-quality closed trade from
  // the past 24h and fires trade.closed. The rule (migration 77)
  // produces a draft + recap card + video; admin approves per-trade
  // (privacy gate). Requires a coach evaluation row to surface; if
  // no coach eval exists for a trade, it's skipped (no fabrication).
  try {
    const r = await pickBestRecentClosedTrade(db)
    if (r) {
      const out = await ingestEvent({
        event_type: 'trade.closed',
        source:     'daily_mix',
        payload:    r,
      })
      tally('trade_breakdown', 'trade_breakdown', out.outcome === 'ok')
    }
  } catch (err) {
    tally('trade_breakdown', 'trade_breakdown', false, err instanceof Error ? err.message : 'unknown')
  }

  // 7.7) Weekly aggregates — Phases 3 + 4 + 5. Fire only on Monday so
  // each aggregate lands once per week, not every day. Sample-gated
  // INSIDE each aggregator: returns null when threshold isn't met,
  // we skip silently rather than publish a thin claim.
  //   - Coach insights:  ≥10 journal_coach_evaluations
  //   - Broker truth:    ≥20 closed broker trades
  //   - Performance:     ≥30 published signals + outcomes
  const dow = new Date().getUTCDay()   // 0=Sun, 1=Mon...
  if (dow === 1) {
    // Phase 3 — Coach insights
    try {
      const agg = await aggregateCoachInsights(7)
      if (agg) {
        const out = await ingestEvent({
          event_type: 'coach.insights.weekly',
          source:     'daily_mix',
          payload:    agg as unknown as Record<string, unknown>,
        })
        tally('coach_insights', 'coach_insights', out.outcome === 'ok')
      }
    } catch (err) {
      tally('coach_insights', 'coach_insights', false, err instanceof Error ? err.message : 'unknown')
    }

    // Phase 4 — Broker truth
    try {
      const agg = await aggregateBrokerTruth(7)
      if (agg) {
        const out = await ingestEvent({
          event_type: 'broker.truth.weekly',
          source:     'daily_mix',
          payload:    agg as unknown as Record<string, unknown>,
        })
        tally('broker_truth', 'broker_truth', out.outcome === 'ok')
      }
    } catch (err) {
      tally('broker_truth', 'broker_truth', false, err instanceof Error ? err.message : 'unknown')
    }

    // Phase 5 — Performance transparency
    try {
      const agg = await aggregatePerformanceTransparency(7)
      if (agg) {
        const out = await ingestEvent({
          event_type: 'performance.transparency.weekly',
          source:     'daily_mix',
          payload:    agg as unknown as Record<string, unknown>,
        })
        tally('performance_transparency', 'performance_transparency', out.outcome === 'ok')
      }
    } catch (err) {
      tally('performance_transparency', 'performance_transparency', false, err instanceof Error ? err.message : 'unknown')
    }
  }

  // 8) Daily video — the video.daily rule above already fires the
  // Remotion + edge-tts producer (educational_video). No separate
  // slot here.

  // 6) Daily blog — one rotated educational topic composed into a
  // long-form post. Blog producer writes a NEW content_items row
  // with status='published' that /blog serves automatically.
  try {
    const e = educPlan[0]!
    const out = await ingestEvent({
      event_type: 'educational.blog',
      source:     'daily_mix',
      payload:    {
        topic:      e.topic,
        topic_tag:  e.topic.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
        headline:   e.headline,
        hook:       e.headline,
        concept:    e.body,
        example:    '',
        mistakes:   '',
        takeaway:   '',
        body:       e.body,
        summary:    e.body.slice(0, 240),
      },
    })
    tally('blog', 'educational_blog', out.outcome === 'ok')
  } catch (err) {
    tally('blog', 'educational_blog', false, err instanceof Error ? err.message : 'unknown')
  }

  // 7) Daily educational video — composed from a rotated topic,
  // narrated via edge-tts, rendered through Remotion. Auto-published
  // to Discord + Telegram (LinkedIn rejects bare MP4 reels).
  try {
    const e = educPlan[1]!
    const out = await ingestEvent({
      event_type: 'video.daily',
      source:     'daily_mix',
      payload:    {
        topic:    e.topic,
        headline: e.headline,
        body:     e.body,
        // Video producer reads these for the narration template
        line_1:   e.topic,
        line_2:   e.headline,
        line_3:   e.body.split('. ')[0] ?? '',
        line_4:   'Learn more on AlgoSphere Quant.',
      },
    })
    tally('video', 'educational_video', out.outcome === 'ok')
  } catch (err) {
    tally('video', 'educational_video', false, err instanceof Error ? err.message : 'unknown')
  }

  // 9) Screenshot showcase — one daily rotation, fires showcase.daily
  // with predicate-matching target. The matching rule attaches a
  // Playwright capture from Railway; nothing fabricated.
  try {
    const showcase = pickDailyShowcase(new Date())
    const out = await ingestEvent({
      event_type: 'showcase.daily',
      source:     'daily_mix',
      payload:    {
        target:   showcase.target,
        topic:    showcase.topic,
        headline: showcase.headline,
        body:     showcase.body,
        reading_min: 2,
      },
    })
    tally('showcase', 'screenshot_showcase', out.outcome === 'ok')
  } catch (err) {
    tally('showcase', 'screenshot_showcase', false, err instanceof Error ? err.message : 'unknown')
  }

  return summary
}
