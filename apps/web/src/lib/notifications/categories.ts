/**
 * Notification taxonomy — the single source of truth for how raw
 * `social_notifications.notif_type` values bucket into the user-facing
 * categories in the NotificationBell dropdown and the `/alerts`
 * preference panel.
 *
 * Adding a new notif_type? Map it here. Anything unmapped falls into
 * the System bucket so it's never silently dropped.
 */
import {
  Activity, Cpu, Repeat, MessagesSquare, ShieldAlert, GraduationCap,
  Globe, Settings2, type LucideIcon,
} from 'lucide-react'

export type CategoryKey =
  | 'signals' | 'execution' | 'copy' | 'social'
  | 'risk'    | 'education' | 'markets' | 'system'

export interface Category {
  key:   CategoryKey
  label: string
  icon:  LucideIcon
  /** Short description shown in the prefs panel. */
  hint:  string
}

export const CATEGORIES: Category[] = [
  { key: 'signals',   label: 'Signals',   icon: Activity,       hint: 'New AI signals, leader publishes, smart-money pings' },
  { key: 'execution', label: 'Execution', icon: Cpu,            hint: 'Order fills, broker errors, kill-switch breaches' },
  { key: 'copy',      label: 'Copy',      icon: Repeat,         hint: 'Copy-trade opens, closes, and follower activity' },
  { key: 'social',    label: 'Social',    icon: MessagesSquare, hint: 'Comments, mentions, likes, new followers' },
  { key: 'risk',      label: 'Risk',      icon: ShieldAlert,    hint: 'Drawdown limits, daily loss caps, volatility alerts' },
  { key: 'education', label: 'Learning',  icon: GraduationCap,  hint: 'New courses, lessons, weekly psychology reports' },
  { key: 'markets',   label: 'Markets',   icon: Globe,          hint: 'Regime flips, whale moves, trending pairs, news' },
  { key: 'system',    label: 'System',    icon: Settings2,      hint: 'Verification updates, billing, account & misc' },
]

export const CATEGORY_BY_KEY: Record<CategoryKey, Category> =
  Object.fromEntries(CATEGORIES.map((c) => [c.key, c])) as Record<CategoryKey, Category>

/** Routes any notif_type → its category bucket. Unknown → 'system'. */
const TYPE_TO_CATEGORY: Record<string, CategoryKey> = {
  // Signals
  signal_from_leader:     'signals',
  new_signal:             'signals',
  smart_money_alert:      'signals',
  // Execution
  execution_fill:         'execution',
  execution_failed:       'execution',
  kill_switch:            'execution',
  broker_error:           'execution',
  // Copy
  copy_trade_opened:      'copy',
  copy_trade_ready:       'copy',
  copy_trade_closed:      'copy',
  copy_trade_failed:      'copy',
  strategy_sub:           'copy',
  earning_accrued:        'copy',
  // Social
  new_follower:           'social',
  new_comment:            'social',
  post_liked:             'social',
  mention:                'social',
  // Risk
  drawdown_warning:       'risk',
  daily_loss_breach:      'risk',
  volatility_alert:       'risk',
  prop_breach:            'risk',
  // Education
  lesson_published:       'education',
  weekly_psychology:      'education',
  course_completed:       'education',
  // Markets
  regime_change:          'markets',
  whale_alert:            'markets',
  trending_asset:         'markets',
  market_news:            'markets',
  // System / misc
  verification_approved:  'system',
  verification_rejected:  'system',
  rank_change:            'system',
  trial_expiring:         'system',
  payment_approved:       'system',
  payment_rejected:       'system',
}

export function categoryFor(notifType: string): CategoryKey {
  return TYPE_TO_CATEGORY[notifType] ?? 'system'
}
