'use client'

import { cn } from '@/lib/utils'

interface Props {
  value: number
  max?: number
  className?: string
  barClassName?: string
}

export default function ProgressBar({ value, max = 100, className, barClassName }: Props) {
  const pct = Math.min(Math.max((value / max) * 100, 0), 100)
  return (
    <div className={cn('h-1.5 w-full overflow-hidden rounded-full bg-muted', className)}>
      <div
        className={cn('h-full rounded-full transition-all duration-500', barClassName ?? 'bg-primary')}
        // dynamic width is data-driven — no static Tailwind class can express this
        // eslint-disable-next-line react/forbid-component-props
        style={{ width: `${pct}%` }}
      />
    </div>
  )
}
