/**
 * Broker portal registry — the static "where do I go to reach this broker"
 * map that powers the Broker Access panel on /overview.
 *
 * Honesty contract: this file holds only well-known, publicly-documented
 * official URLs and brand metadata. It never derives or guesses account
 * data. The trading data (equity, status, sync time) comes from the
 * encrypted `broker_connections` row; this registry only answers "given a
 * broker key, where is its client portal and trading platform?".
 *
 * Two layers:
 *   1. PORTALS — keyed by the canonical `broker` column value
 *      (binance / bybit / okx / mt5 / oanda / tradovate / ctrader / paper).
 *   2. MT5_BROKER_PORTALS — MetaTrader rows all share broker='mt5'; the
 *      real brokerage (Pepperstone, IC Markets, FTMO, …) lives in the
 *      user's label or server name. We match those by keyword so a
 *      "Pepperstone-Demo" MT5 row can still deep-link the right portal.
 *      No match → we fall back to the generic MetaTrader platform links
 *      rather than inventing a URL.
 */

export interface BrokerPortal {
  /** Human display name. */
  name: string
  /** Two-letter monogram for the logo badge (no image assets — honest, brand-tinted initials). */
  monogram: string
  /** Tailwind classes for the logo badge background/border/text tint. */
  badge: string
  /** Official client/account portal URL, or null if the broker has no external portal (e.g. paper). */
  portalUrl: string | null
  /**
   * Web trading terminal, if the broker offers a browser-based platform.
   * MetaTrader rows use the shared web terminal; crypto venues link their
   * own trade screen.
   */
  webTradeUrl?: string
  /** True for MetaTrader-family rows — unlocks the MT4/MT5 quick-launch block. */
  isMetaTrader?: boolean
}

export const PORTALS: Record<string, BrokerPortal> = {
  binance: {
    name: 'Binance Futures',
    monogram: 'BN',
    badge: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
    portalUrl: 'https://www.binance.com/en/my/dashboard',
    webTradeUrl: 'https://www.binance.com/en/futures',
  },
  bybit: {
    name: 'Bybit',
    monogram: 'BY',
    badge: 'border-yellow-400/40 bg-yellow-400/10 text-yellow-300',
    portalUrl: 'https://www.bybit.com/user/assets/home/overview',
    webTradeUrl: 'https://www.bybit.com/trade/usdt/BTCUSDT',
  },
  okx: {
    name: 'OKX',
    monogram: 'OK',
    badge: 'border-sky-400/40 bg-sky-400/10 text-sky-200',
    portalUrl: 'https://www.okx.com/balance/overview',
    webTradeUrl: 'https://www.okx.com/trade-swap/btc-usdt-swap',
  },
  oanda: {
    name: 'OANDA',
    monogram: 'OA',
    badge: 'border-blue-400/40 bg-blue-400/10 text-blue-200',
    portalUrl: 'https://www.oanda.com/account/login',
    webTradeUrl: 'https://trade.oanda.com',
  },
  tradovate: {
    name: 'Tradovate',
    monogram: 'TV',
    badge: 'border-indigo-400/40 bg-indigo-400/10 text-indigo-200',
    portalUrl: 'https://trader.tradovate.com',
    webTradeUrl: 'https://trader.tradovate.com',
  },
  ctrader: {
    name: 'cTrader',
    monogram: 'CT',
    badge: 'border-rose-400/40 bg-rose-400/10 text-rose-200',
    portalUrl: 'https://ctrader.com/',
    webTradeUrl: 'https://app.ctrader.com',
  },
  mt5: {
    name: 'MetaTrader 5',
    monogram: 'M5',
    badge: 'border-emerald-400/40 bg-emerald-400/10 text-emerald-200',
    // MT5 rows have no single portal — the real brokerage lives in the
    // label/server. We resolve that via MT5_BROKER_PORTALS and otherwise
    // fall back to the platform links below.
    portalUrl: null,
    webTradeUrl: 'https://web.metatrader.app/terminal',
    isMetaTrader: true,
  },
  paper: {
    name: 'Paper Trading',
    monogram: 'PA',
    badge: 'border-zinc-400/40 bg-zinc-400/10 text-zinc-300',
    // Internal simulated account — there is no external portal to open.
    portalUrl: null,
  },
}

/** MetaTrader platform links shown in the MT4/MT5 quick-access block. */
export const METATRADER = {
  mt5Web: 'https://web.metatrader.app/terminal',
  // Opens the terminal straight into the "create demo account" flow
  // (MetaQuotes-documented `startup_mode=open_demo`) so a user whose demo
  // expired can mint a fresh, working login in one step instead of fighting
  // an "invalid account or password" on a purged demo.
  mt5OpenDemo: 'https://web.metatrader.app/terminal?startup_mode=open_demo',
  mt5Download: 'https://www.metatrader5.com/en/download',
  mt4Download: 'https://www.metatrader4.com/en/download',
}

/**
 * Build a deep link into the MetaTrader 5 web terminal with the broker
 * server (and login) pre-selected, so the user only types their password
 * instead of hunting a long server dropdown and discovering — the hard
 * way — that MetaTrader does NOT log in with an email.
 *
 * Params are the MetaQuotes-documented ones (verified against the MQL5
 * web-terminal docs): `servers` populates the dropdown, `trade_server`
 * preselects one (must appear in `servers`), `login` prefills the account
 * number. Server names are case-sensitive, so we pass the stored value
 * verbatim. The password is never included — it cannot be prefilled.
 *
 * Degrades safely: with no server we return the plain terminal URL (the
 * current behaviour), and an unsupported param is simply ignored by the
 * terminal, leaving the normal login form.
 */
export function buildMt5WebUrl(server?: string | null, login?: string | null): string {
  const s = (server ?? '').trim()
  const l = (login ?? '').trim()
  if (!s) return METATRADER.mt5Web

  const url = new URL(METATRADER.mt5Web)
  url.searchParams.set('servers', s)
  url.searchParams.set('trade_server', s)
  // Login is the numeric MT5 account number; only attach a plausible one.
  if (/^\d+$/.test(l)) url.searchParams.set('login', l)
  return url.toString()
}

/**
 * Best-effort redirect to a broker's trading platform for a given symbol —
 * used from the signal feed so a trader can jump straight from an AlgoSphere
 * signal to the same pair on their broker.
 *
 * Deep-links to the exact market only where the venue's URL scheme reliably
 * supports it (the crypto exchanges); everywhere else (MT5 / OANDA / cTrader
 * / Tradovate) it returns the platform's base URL, since those don't take a
 * symbol in the URL. Always returns a usable URL when the broker is known,
 * or null when there's nothing sensible to open (e.g. paper).
 */
export function brokerTradeUrl(broker: string, symbol?: string | null): string | null {
  const p = PORTALS[broker]
  const base = p?.webTradeUrl ?? p?.portalUrl ?? null
  const s = (symbol ?? '').toUpperCase().trim()
  if (!s) return base

  switch (broker) {
    case 'binance':
      return s.endsWith('USDT') ? `https://www.binance.com/en/futures/${s}` : base
    case 'bybit':
      return s.endsWith('USDT') ? `https://www.bybit.com/trade/usdt/${s}` : base
    case 'okx':
      return s.endsWith('USDT')
        ? `https://www.okx.com/trade-swap/${s.slice(0, -4).toLowerCase()}-usdt-swap`
        : base
    default:
      // mt5 / oanda / ctrader / tradovate / paper / unknown — no reliable
      // per-symbol URL; open the platform/portal base instead.
      return base
  }
}

/**
 * Keyword → portal map for MetaTrader sub-brokers. Keys are matched
 * case-insensitively against the connection's label and (where present)
 * account hint. Order matters only for readability — keys are distinct.
 */
const MT5_BROKER_PORTALS: Array<{ match: string[]; name: string; url: string }> = [
  { match: ['pepperstone'],                 name: 'Pepperstone',  url: 'https://secure.pepperstone.com/' },
  { match: ['icmarkets', 'ic markets', 'ic-markets'], name: 'IC Markets', url: 'https://secure.icmarkets.com/Account/Login' },
  { match: ['exness'],                       name: 'Exness',       url: 'https://my.exness.com/' },
  { match: ['ftmo'],                         name: 'FTMO',         url: 'https://trader.ftmo.com/' },
  { match: ['funding pips', 'fundingpips'],  name: 'Funding Pips', url: 'https://dashboard.fundingpips.com/' },
  { match: ['fpmarkets', 'fp markets'],      name: 'FP Markets',   url: 'https://secure.fpmarkets.com/' },
  { match: ['vantage'],                      name: 'Vantage',      url: 'https://secure.vantagemarkets.com/' },
  { match: ['xm'],                           name: 'XM',           url: 'https://www.xm.com/member/login' },
  { match: ['the5ers', '5ers'],             name: 'The5ers',      url: 'https://app.the5ers.com/' },
  { match: ['myfundedfx', 'my funded fx'],   name: 'MyFundedFX',   url: 'https://dashboard.myfundedfx.com/' },
]

/**
 * Resolve the access metadata for one broker connection.
 *
 * @param broker  the canonical `broker` column value
 * @param hints   free-text fields (label, account_id) used to disambiguate
 *                MetaTrader sub-brokers; ignored for non-MT5 rows.
 */
export function resolvePortal(
  broker: string,
  hints: Array<string | null | undefined> = [],
): BrokerPortal & { resolvedFrom?: string } {
  const base = PORTALS[broker] ?? {
    name: broker.charAt(0).toUpperCase() + broker.slice(1),
    monogram: broker.slice(0, 2).toUpperCase(),
    badge: 'border-border bg-muted/20 text-muted-foreground',
    portalUrl: null,
  }

  if (broker !== 'mt5') return base

  // MetaTrader: try to upgrade the generic platform link to the actual
  // brokerage portal using the user's own label/server text.
  const haystack = hints.filter(Boolean).join(' ').toLowerCase()
  if (haystack) {
    for (const entry of MT5_BROKER_PORTALS) {
      if (entry.match.some((m) => haystack.includes(m))) {
        return { ...base, name: `${entry.name} · MT5`, portalUrl: entry.url, resolvedFrom: entry.name }
      }
    }
  }
  return base
}
