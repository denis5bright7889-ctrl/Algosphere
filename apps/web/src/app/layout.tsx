import type { Metadata, Viewport } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'

const inter = Inter({ subsets: ['latin'] })

const SITE_URL  = 'https://algospherequant.com'
const SITE_DESC =
  'Professional trading signals, risk management, and analytics — all in one platform.'

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: 'AlgoSphere Quant',
    template: '%s | AlgoSphere Quant',
  },
  description: SITE_DESC,
  keywords: ['trading signals', 'forex', 'risk management', 'trade journal', 'AI trading'],
  // Default OG / Twitter — per-page `opengraph-image.tsx` files supply images.
  // Without this every share rendered a naked URL; this turns every link into
  // a rich card on X / Telegram / Reddit / iMessage / LinkedIn / Discord.
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
      <body className={inter.className}>{children}</body>
    </html>
  )
}
