/**
 * robots.txt — public marketing surface only.
 *
 * Excludes /dashboard, /admin, /api, /demo, and the auth flow from
 * crawlers. The sitemap is referenced so good crawlers find every
 * blog post the moment it goes live.
 */
import type { MetadataRoute } from 'next'

const SITE = process.env.NEXT_PUBLIC_APP_URL ?? 'https://algospherequant.com'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow:     ['/'],
        disallow:  [
          '/api/',
          '/admin/',
          '/dashboard/',
          '/overview',
          '/intelligence/',
          '/signals',
          '/journal',
          '/analytics',
          '/risk',
          '/quant-builder',
          '/backtest',
          '/optimization',
          '/automation',
          '/brokers',
          '/settings',
          '/api-keys',
          '/prop',
          '/shadow',
          '/watchlist',
          '/workspace',
          '/calendar',
          '/news',
          '/market',
          '/profile/',
          '/demo/',
          '/feedback',
          '/support',
        ],
      },
    ],
    sitemap: `${SITE}/sitemap.xml`,
    host:    SITE,
  }
}
