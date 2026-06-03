/**
 * Demo Engine config — single source of truth for what we capture,
 * what viewports, and what URL to point at.
 *
 * BASE_URL precedence:
 *   1. process.env.DEMO_BASE_URL
 *   2. http://localhost:3000  (local dev)
 *
 * Authentication: if DEMO_AUTH_EMAIL + DEMO_AUTH_PASSWORD are set the
 * scripts log in via /login before capturing protected routes. If
 * unset, only marketing/public routes are captured (no broker, no
 * journal, no risk dashboard).
 */
export const BASE_URL = (process.env.DEMO_BASE_URL || 'http://localhost:3000').replace(/\/$/, '')

export const AUTH = {
  email:    process.env.DEMO_AUTH_EMAIL    || '',
  password: process.env.DEMO_AUTH_PASSWORD || '',
}

/** Viewports we capture in. Names are used in file paths. */
export const VIEWPORTS = {
  desktop: { width: 1440, height: 900,  deviceScaleFactor: 1.5 },
  tablet:  { width: 768,  height: 1024, deviceScaleFactor: 2 },
  mobile:  { width: 390,  height: 844,  deviceScaleFactor: 3 },
}

/** Public routes — captured without login. */
export const PUBLIC_ROUTES = [
  { id: 'landing',       path: '/',               title: 'Landing'         },
  { id: 'pricing',       path: '/#pricing',       title: 'Pricing'         },
  { id: 'terms',         path: '/terms',          title: 'Terms'           },
  { id: 'privacy',       path: '/privacy',        title: 'Privacy'         },
  { id: 'data-deletion', path: '/data-deletion',  title: 'Data Deletion'   },
  { id: 'login',         path: '/login',          title: 'Login'           },
  { id: 'signup',        path: '/signup',         title: 'Sign Up'         },
]

/** Protected routes — require login. Maps to the 4 V3 feature pillars
 *  plus the dashboard chrome. waitFor lets us delay capture until the
 *  page's loaded state is ready (network idle alone isn't enough for
 *  charts / async grids). */
export const PROTECTED_ROUTES = [
  { id: 'overview',         path: '/overview',                    title: 'Dashboard',           waitFor: 'networkidle' },
  { id: 'ai-coach',         path: '/intelligence/me',             title: 'AI Coach',            waitFor: 'networkidle' },
  { id: 'psychology',       path: '/psychology',                  title: 'Psychology',          waitFor: 'networkidle' },
  { id: 'analytics',        path: '/analytics',                   title: 'Performance',         waitFor: 'networkidle' },
  { id: 'risk',             path: '/risk',                        title: 'Risk Intelligence',   waitFor: 'networkidle' },
  { id: 'alerts',           path: '/alerts',                      title: 'Smart Alerts',        waitFor: 'networkidle' },
  { id: 'brokers',          path: '/brokers',                     title: 'Broker Connections',  waitFor: 'networkidle' },
  { id: 'journal',          path: '/journal',                     title: 'Trade Journal',       waitFor: 'networkidle' },
  { id: 'intelligence',     path: '/intelligence',                title: 'Market Intelligence', waitFor: 'networkidle' },
  { id: 'capital-flows',    path: '/intelligence/capital-flows',  title: 'Capital Flows',       waitFor: 'networkidle' },
  { id: 'sentiment',        path: '/intelligence/sentiment',      title: 'Market Sentiment',    waitFor: 'networkidle' },
  { id: 'structure',        path: '/intelligence/structure',      title: 'Market Structure',    waitFor: 'networkidle' },
  { id: 'momentum-hub',     path: '/intelligence/momentum-hub',   title: 'Momentum',            waitFor: 'networkidle' },
  { id: 'correlations',     path: '/intelligence/correlations',   title: 'Correlations',        waitFor: 'networkidle' },
  { id: 'signals',          path: '/signals',                     title: 'AI Signals',          waitFor: 'networkidle' },
  { id: 'quant-builder',    path: '/quant-builder',               title: 'Strategy Builder',    waitFor: 'networkidle' },
  { id: 'backtest',         path: '/backtest',                    title: 'Backtester',          waitFor: 'networkidle' },
  { id: 'algo',             path: '/algo',                        title: 'Auto Trading',        waitFor: 'networkidle' },
  { id: 'watchlist',        path: '/watchlist',                   title: 'Watchlists',          waitFor: 'networkidle' },
  { id: 'communities',      path: '/communities',                 title: 'Community',           waitFor: 'networkidle' },
  { id: 'upgrade',          path: '/upgrade',                     title: 'Billing & Plan',      waitFor: 'networkidle' },
  { id: 'settings',         path: '/settings',                    title: 'Settings',            waitFor: 'networkidle' },
]

/** Recorded flows — sequence of actions per flow. Each step can be
 *  navigate, click, fill, hover, scroll, wait. The recorder drives
 *  the steps in order and saves a webm + frames. */
export const RECORDED_FLOWS = [
  {
    id: 'broker-connect',
    title: 'Connect MT5 in 60 seconds',
    auth: true,
    steps: [
      { action: 'navigate', path: '/brokers' },
      { action: 'wait',     ms: 1500 },
      { action: 'click',    selector: 'text=/Add.*broker/i' },
      { action: 'wait',     ms: 1000 },
      { action: 'click',    selector: 'text=/MT5/i' },
      { action: 'wait',     ms: 800 },
      { action: 'fill',     selector: 'input[name="login"]',    text: '123456' },
      { action: 'fill',     selector: 'input[name="password"]', text: 'demo-pass' },
      { action: 'fill',     selector: 'input[name="server"]',   text: 'Exness-Demo' },
      { action: 'wait',     ms: 1500 },
    ],
  },
  {
    id: 'place-trade',
    title: 'Take a signal from the feed',
    auth: true,
    steps: [
      { action: 'navigate', path: '/signals' },
      { action: 'wait',     ms: 2000 },
      { action: 'click',    selector: 'text=/Place.*trade/i' },
      { action: 'wait',     ms: 1500 },
      { action: 'fill',     selector: 'input[type="number"]', text: '0.01' },
      { action: 'wait',     ms: 1000 },
    ],
  },
  {
    id: 'intelligence-tour',
    title: 'Market Intelligence at a glance',
    auth: true,
    steps: [
      { action: 'navigate', path: '/intelligence' },
      { action: 'wait',     ms: 2500 },
      { action: 'scroll',   y: 600 },
      { action: 'wait',     ms: 1500 },
      { action: 'scroll',   y: 1200 },
      { action: 'wait',     ms: 1500 },
      { action: 'navigate', path: '/intelligence/correlations' },
      { action: 'wait',     ms: 2500 },
    ],
  },
  {
    id: 'journal-tour',
    title: 'Auto-journal in action',
    auth: true,
    steps: [
      { action: 'navigate', path: '/journal' },
      { action: 'wait',     ms: 2000 },
      { action: 'scroll',   y: 500 },
      { action: 'wait',     ms: 1500 },
    ],
  },
]
