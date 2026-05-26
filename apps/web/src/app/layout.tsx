import type { Metadata, Viewport } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: {
    default: 'AlgoSphere Quant',
    template: '%s | AlgoSphere Quant',
  },
  description:
    'Institutional-grade market intelligence and AI-assisted execution infrastructure — regime, smart-money flow, liquidity, conviction, and risk in one quantitative operating system.',
  keywords: [
    'institutional trading infrastructure', 'quantitative trading platform',
    'AI execution intelligence', 'market regime', 'smart money flow',
    'liquidity intelligence', 'conviction engine', 'risk analytics',
    'algorithmic trading', 'quant',
  ],
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
