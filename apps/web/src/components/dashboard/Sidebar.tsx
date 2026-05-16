'use client'

import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'

const NAV_ITEMS = [
  { href: '/overview',     label: 'Command Center',      icon: '▤' },
  { href: '/signals',      label: 'Intelligence Feed',   icon: '📡' },
  { href: '/regime',       label: 'Market Regime',       icon: '🧭' },
  { href: '/risk',         label: 'Risk Engine',         icon: '🛡️' },
  { href: '/analytics',    label: 'Performance',         icon: '📊' },
  { href: '/journal',      label: 'Trade Log',           icon: '📓' },
  { href: '/calculators',  label: 'Calculators',         icon: '🧮' },
  { href: '/calendar',     label: 'Economic Calendar',   icon: '📅' },
  { href: '/news',         label: 'Market News',         icon: '📰' },
  { href: '/alerts',       label: 'Alerts',              icon: '🔔' },
  { href: '/market',       label: 'Market Tracker',      icon: '🌐' },
  { href: '/learn',        label: 'Education Hub',        icon: '🎓' },
  { href: '/achievements', label: 'Achievements',        icon: '🏅' },
  { href: '/psychology',   label: 'AI Psychology Coach', icon: '🧠' },
  { href: '/prop',         label: 'Prop Toolkit',        icon: '🏦' },
  { href: '/quant-builder', label: 'Quant Builder',      icon: '🧪' },
  { href: '/execution',    label: 'Execution Desk',      icon: '⚡' },
  { href: '/backtest',     label: 'Backtester',          icon: '🔬' },
  { href: '/social',       label: 'Social Feed',         icon: '💬' },
  { href: '/community',    label: 'Community',           icon: '🗨️' },
  { href: '/communities',  label: 'Premium Groups',      icon: '👑' },
  { href: '/launchpad',    label: 'Token Launchpad',     icon: '🚀' },
  { href: '/strategies',   label: 'Strategies',          icon: '🎯' },
  { href: '/copy',         label: 'Copy Portfolio',      icon: '🔁' },
  { href: '/earnings',     label: 'Creator Earnings',    icon: '💰' },
  { href: '/verification', label: 'Verification',        icon: '✅' },
  { href: '/referrals',    label: 'Affiliate',           icon: '🤝' },
  { href: '/api-keys',     label: 'API Access',          icon: '🔑' },
  { href: '/api-usage',    label: 'API Usage',           icon: '📈' },
  { href: '/traders',      label: 'Leaderboard',         icon: '🏆' },
]

interface Props {
  onNavigate?: () => void
}

export default function Sidebar({ onNavigate }: Props) {
  const pathname = usePathname()

  return (
    <nav className="flex flex-col gap-1 px-2">
      {NAV_ITEMS.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`)
        return (
          <a
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            className={cn(
              'group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-all duration-200',
              active
                ? 'bg-gradient-primary text-white shadow-glow'
                : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
            )}
          >
            {active && (
              <span className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-r bg-white/90" aria-hidden />
            )}
            <span className="text-base leading-none">{item.icon}</span>
            {item.label}
          </a>
        )
      })}
    </nav>
  )
}
