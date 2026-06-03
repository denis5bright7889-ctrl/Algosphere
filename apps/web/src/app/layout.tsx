import type { Metadata, Viewport } from 'next'
import { Inter } from 'next/font/google'
import { Suspense } from 'react'
import './globals.css'
import AttributionTracker from '@/components/growth/AttributionTracker'
import Toaster from '@/components/Toaster'

const inter = Inter({ subsets: ['latin'] })

const SITE_URL  = 'https://algospherequant.com'
const SITE_DESC =
  'Institutional-grade market intelligence and AI-assisted execution infrastructure — regime, smart-money flow, liquidity, conviction, and risk in one quantitative operating system.'

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: 'AlgoSphere Quant',
    template: '%s | AlgoSphere Quant',
  },
  description: SITE_DESC,
  keywords: [
    'institutional trading infrastructure', 'quantitative trading platform',
    'AI execution intelligence', 'market regime', 'smart money flow',
    'liquidity intelligence', 'conviction engine', 'risk analytics',
    'algorithmic trading', 'quant',
  ],
  // Default OG / Twitter — per-page `opengraph-image.tsx` files supply images.
  // This makes EVERY shared URL render a rich card (X / Telegram / Reddit /
  // iMessage / LinkedIn / Discord) instead of a naked link.
  openGraph: {
    type:        'website',
    siteName:    'AlgoSphere Quant',
    title:       'AlgoSphere Quant — Institutional market intelligence',
    description: SITE_DESC,
    url:         SITE_URL,
    locale:      'en_US',
  },
  twitter: {
    card:        'summary_large_image',
    title:       'AlgoSphere Quant — Institutional market intelligence',
    description: SITE_DESC,
  },
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    title:   'AlgoSphere',
    statusBarStyle: 'black-translucent',
  },
  formatDetection: { telephone: false },
}

export const viewport: Viewport = {
  width:        'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor:   '#0a0a0a',
  viewportFit:  'cover',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body className={inter.className}>
        {/* Funnel attribution — pings /api/track/event on every route
            change. Wrapped in Suspense because AttributionTracker uses
            useSearchParams which requires it under partial pre-rendering. */}
        <Suspense fallback={null}>
          <AttributionTracker />
        </Suspense>
        {/* Global toast bus — survives modal close + route changes.
            Sub-components fire toasts via lib/toast.ts showToast(). */}
        <Toaster />
        {children}
      </body>
    </html>
  )
}
