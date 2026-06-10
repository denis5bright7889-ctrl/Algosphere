/**
 * Validation Milestones engine — Phase 10 of the Validation Center.
 *
 * Pure function over the aggregates already computed elsewhere on
 * /shadow. Returns:
 *   • achievements      — every supported badge with earned + criterion
 *   • streak            — current consecutive-winning-trade run
 *
 * Honesty contract:
 *   - Every badge ties to a numeric threshold derived from real
 *     aggregates. A badge can ONLY light up when its criterion is
 *     literally true on the data — no fabricated achievements.
 *   - "Top 1% Validation Score" requires peer-comparison data that
 *     doesn't exist yet; the badge is permanently shown as locked
 *     with an honest "Peer comparison not yet available" message
 *     rather than awarded against a placeholder threshold.
 *   - The "earned_at" field is null for on-the-fly derivations
 *     because the table writer for validation_milestones hasn't
 *     shipped yet. The UI displays "Earned" without a timestamp,
 *     never inventing a date.
 */
import type { BrokerQuality } from './broker-quality-aggregate'
import type { StrategyMetrics } from './strategy-performance-aggregate'
import type { ValidationCoachReview } from './validation-coach'

export type MilestoneKind =
  | 'validated_strategy'
  | 'broker_verified'
  | 'execution_elite'
  | 'risk_master'
  | 'institutional_trader'
  | 'top_percentile'
  | 'streak_5'
  | 'streak_10'
  | 'streak_25'
  | 'streak_50'

export interface Achievement {
  kind:        MilestoneKind
  label:       string
  description: string
  criterion:   string
  earned:      boolean
  /** Progress toward the criterion (0–1). Null when criterion is
   *  binary (no meaningful intermediate progress). */
  progress:    number | null
  /** Human-readable count toward the criterion, e.g. "3/5". */
  progress_label: string | null
  /** Set when the badge can NEVER be earned without external data
   *  the platform doesn't yet collect. */
  blocked_reason: string | null
}

export interface MilestonesReport {
  achievements:           Achievement[]
  earned_count:           number
  total_count:            number
  /** Current consecutive-winning closed-trade streak. */
  current_streak:         number
  /** Highest streak the user has ever hit. */
  best_streak:            number
  /** Total closed trades across all attributed strategies. */
  total_closed_trades:    number
}

interface ClosedTradeOutcome {
  follower_pnl: number
  closed_at:    string | null
}

function currentAndBestStreak(closed: ClosedTradeOutcome[]): { current: number; best: number } {
  // Order by closed_at ASC so "current" is the trailing run from the
  // most-recent closed trade walking backwards.
  const sorted = closed
    .filter(t => typeof t.follower_pnl === 'number' && t.closed_at)
    .sort((a, b) => (a.closed_at ?? '').localeCompare(b.closed_at ?? ''))

  let current = 0
  let best    = 0
  let run     = 0
  for (const t of sorted) {
    if (t.follower_pnl > 0) {
      run++
      if (run > best) best = run
    } else {
      run = 0
    }
  }
  // "current" is the trailing run from the END — same direction.
  for (let i = sorted.length - 1; i >= 0; i--) {
    if (sorted[i]!.follower_pnl > 0) current++
    else break
  }
  return { current, best }
}

export interface MilestonesInput {
  closedTrades:  ClosedTradeOutcome[]
  brokerQuality: BrokerQuality[]
  strategies:    StrategyMetrics[]
  coachReviews:  ValidationCoachReview[]
}

export function deriveMilestones(input: MilestonesInput): MilestonesReport {
  const { closedTrades, brokerQuality, strategies, coachReviews } = input

  // Aggregate-level inputs.
  const totalClosed = strategies.reduce((s, st) => s + st.closed_count, 0)
                   || closedTrades.length
  const { current: currentStreak, best: bestStreak } = currentAndBestStreak(closedTrades)

  const approvedReviews   = coachReviews.filter(r => r.recommendation === 'approve').length
  const aGradedBrokers    = brokerQuality.filter(b => b.grade === 'A+' || b.grade === 'A').length
  const eliteBrokers      = brokerQuality.filter(b => (b.execution_quality_score ?? 0) >= 95).length
  const lowRiskStrategies = strategies.filter(s => (s.risk_score ?? 0) >= 80).length

  const achievements: Achievement[] = [
    {
      kind:        'validated_strategy',
      label:       'Validated Strategy',
      description: 'A strategy the Coach approved for live deployment.',
      criterion:   'Coach recommendation = Approve on ≥ 1 strategy',
      earned:      approvedReviews >= 1,
      progress:    approvedReviews >= 1 ? 1 : 0,
      progress_label: `${approvedReviews}/1`,
      blocked_reason: null,
    },
    {
      kind:        'broker_verified',
      label:       'Broker Verified',
      description: 'A broker earned an A or A+ grade on Execution Quality.',
      criterion:   '≥ 1 broker with grade A or A+',
      earned:      aGradedBrokers >= 1,
      progress:    aGradedBrokers >= 1 ? 1 : 0,
      progress_label: `${aGradedBrokers}/1`,
      blocked_reason: null,
    },
    {
      kind:        'execution_elite',
      label:       'Execution Elite',
      description: 'A broker scored ≥ 95/100 on Execution Quality.',
      criterion:   '≥ 1 broker with score ≥ 95',
      earned:      eliteBrokers >= 1,
      progress:    eliteBrokers >= 1 ? 1 : 0,
      progress_label: `${eliteBrokers}/1`,
      blocked_reason: null,
    },
    {
      kind:        'risk_master',
      label:       'Risk Master',
      description: 'A strategy scored ≥ 80/100 on Risk Score (stable equity curve).',
      criterion:   '≥ 1 strategy with risk_score ≥ 80',
      earned:      lowRiskStrategies >= 1,
      progress:    lowRiskStrategies >= 1 ? 1 : 0,
      progress_label: `${lowRiskStrategies}/1`,
      blocked_reason: null,
    },
    {
      kind:        'institutional_trader',
      label:       'Institutional Trader',
      description: 'Closed 100+ shadow trades attributed to a strategy.',
      criterion:   '≥ 100 closed shadow trades',
      earned:      totalClosed >= 100,
      progress:    Math.min(1, totalClosed / 100),
      progress_label: `${totalClosed}/100`,
      blocked_reason: null,
    },
    {
      kind:        'top_percentile',
      label:       'Top 1% Validation',
      description: 'Validation score ranks in the top 1% across all AlgoSphere users.',
      criterion:   'Peer-comparison data required (not yet available)',
      earned:      false,
      progress:    null,
      progress_label: null,
      // Honest: we don't have cross-user benchmarks yet. The badge
      // appears in the grid but can't be honestly awarded without
      // peer data. Surface the constraint explicitly.
      blocked_reason: 'Peer comparison data not yet available',
    },

    // Streak ladder — earned strictly by the BEST streak the user has
    // hit, not just the current one. So a once-hit 25-streak stays
    // earned even after the current streak resets.
    {
      kind:        'streak_5',
      label:       '5-Trade Streak',
      description: 'Win 5 closed shadow trades in a row.',
      criterion:   'Best streak ≥ 5',
      earned:      bestStreak >= 5,
      progress:    Math.min(1, bestStreak / 5),
      progress_label: `${Math.min(bestStreak, 5)}/5`,
      blocked_reason: null,
    },
    {
      kind:        'streak_10',
      label:       '10-Trade Streak',
      description: 'Win 10 closed shadow trades in a row.',
      criterion:   'Best streak ≥ 10',
      earned:      bestStreak >= 10,
      progress:    Math.min(1, bestStreak / 10),
      progress_label: `${Math.min(bestStreak, 10)}/10`,
      blocked_reason: null,
    },
    {
      kind:        'streak_25',
      label:       '25-Trade Streak',
      description: 'Win 25 closed shadow trades in a row.',
      criterion:   'Best streak ≥ 25',
      earned:      bestStreak >= 25,
      progress:    Math.min(1, bestStreak / 25),
      progress_label: `${Math.min(bestStreak, 25)}/25`,
      blocked_reason: null,
    },
    {
      kind:        'streak_50',
      label:       '50-Trade Streak',
      description: 'Win 50 closed shadow trades in a row.',
      criterion:   'Best streak ≥ 50',
      earned:      bestStreak >= 50,
      progress:    Math.min(1, bestStreak / 50),
      progress_label: `${Math.min(bestStreak, 50)}/50`,
      blocked_reason: null,
    },
  ]

  return {
    achievements,
    earned_count:        achievements.filter(a => a.earned).length,
    total_count:         achievements.length,
    current_streak:      currentStreak,
    best_streak:         bestStreak,
    total_closed_trades: totalClosed,
  }
}
