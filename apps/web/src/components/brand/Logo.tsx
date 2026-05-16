import Image from 'next/image'
import { cn } from '@/lib/utils'

interface Props {
  size?:    'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl'
  className?: string
  priority?:  boolean
  /** Hide visually but keep for screen readers. Used when paired with brand text. */
  alt?:       string
}

const PX = {
  xs:  24,
  sm:  32,
  md:  44,
  lg:  72,
  xl:  120,
  '2xl': 200,
} as const

/**
 * AlgoSphere Quant brand mark.
 * Source file: /public/logo-algosphere.png (full square logo with text).
 *
 * Use small sizes (xs/sm) when paired with separate brand text — the embedded
 * lettering becomes unreadable below ~64px.
 */
export default function Logo({
  size      = 'md',
  className,
  priority,
  alt       = 'AlgoSphere Quant',
}: Props) {
  const px = PX[size]
  return (
    <Image
      src="/logo-algosphere.png"
      alt={alt}
      width={px}
      height={px}
      quality={100}
      priority={priority}
      // The source PNG is RGB (no alpha) with a baked black background.
      // On the dark theme, `mix-blend-screen` makes the pure-black pixels
      // render transparent — a real fix until the asset is re-exported
      // as an RGBA/SVG with a true alpha channel.
      className={cn('object-contain shrink-0 select-none mix-blend-screen', className)}
      draggable={false}
    />
  )
}
