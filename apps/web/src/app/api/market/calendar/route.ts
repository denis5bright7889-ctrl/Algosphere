import { NextResponse } from 'next/server'

/**
 * Economic calendar — proxies the free ForexFactory weekly JSON feed.
 * Cached 30 min. Graceful fallback to an empty set so the page never breaks.
 */

const FF_URL = 'https://nfs.faireconomy.media/ff_calendar_thisweek.json'

export interface EconEvent {
  title:    string
  country:  string
  date:     string
  impact:   'High' | 'Medium' | 'Low' | 'Holiday'
  forecast: string
  previous: string
}

let cache: { at: number; data: EconEvent[] } | null = null
const TTL = 30 * 60 * 1000

export async function GET() {
  if (cache && Date.now() - cache.at < TTL) {
    return NextResponse.json({ events: cache.data, cached: true })
  }

  try {
    const res = await fetch(FF_URL, {
      headers: { 'User-Agent': 'AlgoSphereQuant/1.0' },
      next: { revalidate: 1800 },
    })
    if (!res.ok) throw new Error(`FF ${res.status}`)
    const raw = await res.json()

    const events: EconEvent[] = (Array.isArray(raw) ? raw : []).map((e: any) => ({
      title:    String(e.title ?? ''),
      country:  String(e.country ?? ''),
      date:     String(e.date ?? ''),
      impact:   (e.impact ?? 'Low') as EconEvent['impact'],
      forecast: String(e.forecast ?? ''),
      previous: String(e.previous ?? ''),
    }))

    cache = { at: Date.now(), data: events }
    return NextResponse.json({ events, cached: false })
  } catch (err) {
    console.error('economic calendar fetch failed:', err)
    // Serve stale cache if present, else empty
    return NextResponse.json({
      events: cache?.data ?? [],
      cached: !!cache,
      degraded: true,
    })
  }
}
