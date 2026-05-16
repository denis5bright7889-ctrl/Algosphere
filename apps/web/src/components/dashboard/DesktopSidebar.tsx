'use client'

import { useEffect, useState } from 'react'
import { ChevronsLeft, ChevronsRight, Settings2 } from 'lucide-react'
import Sidebar from './Sidebar'
import Logo from '@/components/brand/Logo'
import { cn } from '@/lib/utils'

const LS_KEY = 'as_sidebar_collapsed'

interface Props {
  admin: boolean
  showUpgradePrompt: boolean
}

export default function DesktopSidebar({ admin, showUpgradePrompt }: Props) {
  const [collapsed, setCollapsed] = useState(false)
  const [hovered, setHovered] = useState(false)
  const [mounted, setMounted] = useState(false)

  // Restore persisted preference (client-only — avoids hydration mismatch)
  useEffect(() => {
    setCollapsed(localStorage.getItem(LS_KEY) === '1')
    setMounted(true)
  }, [])

  function toggle() {
    setCollapsed((c) => {
      const next = !c
      localStorage.setItem(LS_KEY, next ? '1' : '0')
      return next
    })
  }

  // Hover-expand: a collapsed rail temporarily expands on pointer-over
  const compact = collapsed && !hovered

  return (
    <aside
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className={cn(
        'hidden md:flex shrink-0 flex-col border-r border-border/70',
        'glass-strong py-6 transition-[width] duration-300 ease-out',
        // Smooth width animation only after first paint
        mounted ? '' : 'duration-0',
        compact ? 'w-[4.75rem]' : 'w-60',
      )}
    >
      {/* Brand + collapse toggle */}
      <div className={cn('mb-6 flex items-center', compact ? 'flex-col gap-3 px-2' : 'justify-between px-4')}>
        <a href="/overview" className="flex items-center gap-2 group min-w-0">
          <Logo size="sm" alt="" priority />
          {!compact && (
            <span className="text-base font-bold tracking-tight truncate">
              <span className="text-gradient">AlgoSphere</span>{' '}
              <span className="text-foreground/90">Quant</span>
            </span>
          )}
        </a>
        <button
          type="button"
          onClick={toggle}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
        >
          {collapsed
            ? <ChevronsRight className="h-4 w-4" strokeWidth={1.75} />
            : <ChevronsLeft className="h-4 w-4" strokeWidth={1.75} />}
        </button>
      </div>

      {admin && !compact && (
        <div className="px-4 mb-3">
          <span className="inline-block rounded-full border border-red-500/30 bg-red-500/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-red-400">
            Admin
          </span>
        </div>
      )}

      <div className="flex-1 min-h-0">
        <Sidebar collapsed={compact} />
      </div>

      {admin && (
        <div className={cn('mt-2', compact ? 'px-2' : 'px-4')}>
          <a
            href="/admin/dashboard"
            title={compact ? 'Admin Dashboard' : undefined}
            className={cn(
              'flex items-center rounded-lg border border-red-500/30 bg-red-500/10 text-xs font-semibold text-red-300',
              'transition-all hover:bg-red-500/20 hover:shadow-glow-red',
              compact ? 'justify-center py-2.5' : 'gap-2 px-3 py-2',
            )}
          >
            <Settings2 className="h-[18px] w-[18px] shrink-0" strokeWidth={1.75} aria-hidden />
            {!compact && <span>Admin Dashboard</span>}
          </a>
        </div>
      )}

      {showUpgradePrompt && !compact && (
        <div className="mt-3 px-4">
          <a href="/upgrade" className="btn-premium w-full !text-xs">
            Upgrade to Pro
          </a>
        </div>
      )}
    </aside>
  )
}
