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
    'Professional trading signals, risk management, and analytics — all in one platform.',
  keywords: ['trading signals', 'forex', 'risk management', 'trade journal', 'AI trading'],
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
  maximumScale: 5,
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
