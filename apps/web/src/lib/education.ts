/**
 * Education hub content registry.
 * Static curriculum — no DB needed for content; progress stored client-side
 * (localStorage) for Starter, can be promoted to a table later.
 */

export interface Lesson {
  slug:     string
  title:    string
  minutes:  number
  summary:  string
  body:     string[]    // paragraphs
  takeaways: string[]
}

export interface Course {
  slug:        string
  title:       string
  level:       'beginner' | 'intermediate' | 'advanced'
  icon:        string
  description: string
  lessons:     Lesson[]
}

export const COURSES: Course[] = [
  {
    slug: 'foundations',
    title: 'Trading Foundations',
    level: 'beginner',
    icon: '📘',
    description: 'The absolute basics — markets, orders, and how money moves.',
    lessons: [
      {
        slug: 'what-is-forex',
        title: 'What Is Forex & CFD Trading',
        minutes: 6,
        summary: 'How currency pairs, lots, and pips actually work.',
        body: [
          'Forex is the exchange of one currency for another. Prices are quoted in pairs like EURUSD — how many US dollars one euro buys.',
          'A "pip" is the smallest standard price move (0.0001 for most pairs, 0.01 for JPY pairs). A "lot" is your position size — 1 standard lot = 100,000 units.',
          'CFDs (contracts for difference) let you trade gold, indices, and crypto the same way without owning the underlying asset.',
        ],
        takeaways: [
          'EURUSD = how many USD per 1 EUR',
          '1 pip = 0.0001 (or 0.01 for JPY)',
          '1 standard lot = 100,000 units',
        ],
      },
      {
        slug: 'order-types',
        title: 'Market, Limit & Stop Orders',
        minutes: 7,
        summary: 'When to use each order type and why it matters.',
        body: [
          'A market order fills immediately at the current price — fast but you accept slippage.',
          'A limit order only fills at your chosen price or better — patience over speed.',
          'A stop order triggers once price reaches a level, used for breakouts and protective stop losses.',
        ],
        takeaways: [
          'Market = speed, accepts slippage',
          'Limit = price control, may not fill',
          'Stop loss is non-negotiable on every trade',
        ],
      },
    ],
  },
  {
    slug: 'risk-101',
    title: 'Risk Management 101',
    level: 'beginner',
    icon: '🛡️',
    description: 'The single skill that separates survivors from blow-ups.',
    lessons: [
      {
        slug: 'the-1-percent-rule',
        title: 'The 1% Rule',
        minutes: 5,
        summary: 'Never risk more than 1% of your account on one trade.',
        body: [
          'Risking 1% means even a 10-trade losing streak only draws you down ~10%. Risking 10% per trade and the same streak wipes you out.',
          'Use the Position Size calculator: account balance × 1% ÷ (stop distance in pips × pip value) = your lot size.',
          'Consistency in risk is what makes a positive edge compound instead of evaporate.',
        ],
        takeaways: [
          'Risk ≤ 1% per trade',
          'Fixed % risk survives losing streaks',
          'Always size from your stop, not your hope',
        ],
      },
      {
        slug: 'rr-ratio',
        title: 'Risk-to-Reward Ratios',
        minutes: 6,
        summary: 'Why a 1:2 R:R lets you be wrong more than half the time.',
        body: [
          'At 1:2 R:R you only need a 34% win rate to break even. At 1:1 you need 50%.',
          'Higher R:R targets reduce the win rate you need but may reduce how often targets are hit — balance is key.',
          'Log every trade\'s planned R:R in the journal and review whether you actually held to target.',
        ],
        takeaways: [
          '1:2 R:R → breakeven at 34% win rate',
          'Higher R:R lowers required accuracy',
          'Plan R:R before entry, never after',
        ],
      },
    ],
  },
  {
    slug: 'psychology',
    title: 'Trading Psychology',
    level: 'intermediate',
    icon: '🧠',
    description: 'Master the inner game — tilt, FOMO, and discipline.',
    lessons: [
      {
        slug: 'tilt-and-revenge',
        title: 'Tilt & Revenge Trading',
        minutes: 6,
        summary: 'How one bad loss becomes five, and how to stop it.',
        body: [
          'Revenge trading is taking an unplanned trade to "win back" a loss. It is the single most account-destructive habit.',
          'The fix is mechanical: after any loss that breaks your daily risk, you are done for the session. No exceptions.',
          'Track emotion in the journal pre- and post-trade. Patterns emerge — most traders lose disproportionately when "anxious" or "FOMO".',
        ],
        takeaways: [
          'One revenge trade rarely stays one',
          'Daily loss limit = hard stop, walk away',
          'Log emotions to expose your patterns',
        ],
      },
    ],
  },
]

export function findCourse(slug: string): Course | undefined {
  return COURSES.find(c => c.slug === slug)
}

export function findLesson(courseSlug: string, lessonSlug: string) {
  const course = findCourse(courseSlug)
  const lesson = course?.lessons.find(l => l.slug === lessonSlug)
  return { course, lesson }
}

export function totalLessons(): number {
  return COURSES.reduce((s, c) => s + c.lessons.length, 0)
}
