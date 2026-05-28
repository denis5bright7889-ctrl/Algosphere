'use client'

/**
 * Layout picker — 4 grid presets (single / split-V / split-H / quad).
 * Tiny SVG icons so the choice is visual at a glance. Resize between
 * panels is deferred (see workspace PR rationale).
 */
import { cn } from '@/lib/utils'
import { useWorkspace } from './WorkspaceProvider'
import type { LayoutMode } from '@/lib/workspace-store'

const LAYOUTS: ReadonlyArray<{ mode: LayoutMode; label: string; key: string; icon: React.ReactNode }> = [
  { mode: 'single',  label: 'Single',  key: '1', icon: <Icon><rect x="2" y="2" width="12" height="12" rx="1.5" /></Icon> },
  { mode: 'split-v', label: 'Split V', key: '2', icon: <Icon><rect x="2" y="2" width="5.5" height="12" rx="1" /><rect x="8.5" y="2" width="5.5" height="12" rx="1" /></Icon> },
  { mode: 'split-h', label: 'Split H', key: '3', icon: <Icon><rect x="2" y="2" width="12" height="5.5" rx="1" /><rect x="2" y="8.5" width="12" height="5.5" rx="1" /></Icon> },
  { mode: 'quad',    label: 'Quad',    key: '4', icon: <Icon><rect x="2" y="2" width="5.5" height="5.5" rx="1" /><rect x="8.5" y="2" width="5.5" height="5.5" rx="1" /><rect x="2" y="8.5" width="5.5" height="5.5" rx="1" /><rect x="8.5" y="8.5" width="5.5" height="5.5" rx="1" /></Icon> },
]

function Icon({ children }: { children: React.ReactNode }) {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" stroke="currentColor" strokeWidth="1.2" fill="none" aria-hidden>
      {children}
    </svg>
  )
}

export default function LayoutPicker() {
  const ws = useWorkspace()
  return (
    <div className="flex items-center gap-0.5 rounded-lg border border-border/60 bg-background/40 p-0.5">
      {LAYOUTS.map((l) => {
        const on = ws.activeTab.layout === l.mode
        return (
          <button key={l.mode} type="button"
                  onClick={() => ws.setLayout(l.mode)}
                  title={`${l.label} (${l.key})`}
                  {...{ 'aria-pressed': on }}
                  className={cn(
                    'flex items-center gap-1 rounded-md px-1.5 py-1 text-[10px] font-semibold uppercase tracking-wider transition-colors',
                    on ? 'bg-gradient-primary text-black' : 'text-muted-foreground hover:text-foreground',
                  )}>
            {l.icon}
            <span className="hidden md:inline">{l.label}</span>
          </button>
        )
      })}
    </div>
  )
}
