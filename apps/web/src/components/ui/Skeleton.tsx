import { cn } from '@/lib/utils'

/**
 * Institutional loading skeleton. Calm shimmer (no spinners), uses the
 * same surface tokens as real content so the layout never shifts when
 * data arrives. Compose these to mirror the final component's shape.
 */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn(
        'animate-shimmer rounded-md',
        'bg-[linear-gradient(90deg,hsl(var(--muted)/0.4)_0%,hsl(var(--muted)/0.7)_50%,hsl(var(--muted)/0.4)_100%)]',
        'bg-[length:200%_100%]',
        className,
      )}
    />
  )
}

/** Text-line skeleton stack — `lines` rows, last row 60% width. */
export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div className={cn('space-y-2', className)}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          className={cn('h-3.5', i === lines - 1 ? 'w-3/5' : 'w-full')}
        />
      ))}
    </div>
  )
}

/** Card-shaped skeleton — header line + body lines inside a surface. */
export function SkeletonCard({ className }: { className?: string }) {
  return (
    <div className={cn('rounded-xl border border-border/60 bg-card/40 p-5', className)}>
      <Skeleton className="mb-4 h-5 w-2/5" />
      <SkeletonText lines={3} />
    </div>
  )
}
