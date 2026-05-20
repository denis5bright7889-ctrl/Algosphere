'use client'

import { useEffect, useState } from 'react'

/**
 * Sticky conversion bar — mobile only. Slides in once the visitor has
 * scrolled past the hero so the primary CTA is always one tap away
 * without competing with the hero on first paint.
 */
export default function MobileCtaBar() {
  const [show, setShow] = useState(false)

  useEffect(() => {
    const onScroll = () => setShow(window.scrollY > 640)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <div
      className={
        'fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 px-4 pb-[calc(10px+env(safe-area-inset-bottom))] pt-2.5 backdrop-blur transition-transform duration-300 md:hidden ' +
        (show ? 'translate-y-0' : 'translate-y-full')
      }
    >
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-semibold">Start your 7-day free trial</p>
          <p className="truncate text-[10px] text-muted-foreground">No card required</p>
        </div>
        <a href="/signup" className="btn-premium shrink-0 !px-5 !py-2.5 !text-sm">
          Start free
        </a>
      </div>
    </div>
  )
}
