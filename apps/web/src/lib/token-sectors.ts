/**
 * Token → sector mapping for Capital Rotation intelligence.
 *
 * Curated mapping so the Rotation engine can surface TRUE sector
 * rotation (capital moving from Meme → AI, etc.) rather than chain
 * rotation (Ethereum → Solana). Built from Coingecko's category
 * taxonomy and institutional sector buckets used by Nansen / Messari.
 *
 * The lookup is symbol-only (uppercase). Tokens not in the map fall
 * into the 'Other' bucket — same honesty rule as the rest of the
 * intel layer (we never guess a sector; absent = Other).
 *
 * Sectors are deliberately broad (~9 buckets). Finer-grained taxonomy
 * (LSDfi vs Restaking inside DeFi, for example) is a follow-up.
 */

export type Sector =
  | 'L1'              // base-layer protocols (BTC, ETH, SOL, etc.)
  | 'L2'              // scaling rollups + sidechains
  | 'DeFi'            // lending / DEX / yield protocols
  | 'AI'              // AI compute, agents, data
  | 'Meme'            // meme / community tokens
  | 'RWA'             // tokenised real-world assets
  | 'Gaming'          // games / metaverse / SocialFi
  | 'Infra'           // oracles / bridges / data / privacy / DePIN
  | 'Stable'          // stablecoins
  | 'Other'

const TOKEN_SECTOR: Record<string, Sector> = {
  // ── L1 base-layer ───────────────────────────────────────────────
  BTC: 'L1',  WBTC: 'L1', ETH: 'L1', WETH: 'L1',
  SOL: 'L1',  AVAX: 'L1', DOT: 'L1', ATOM: 'L1', NEAR: 'L1',
  ADA: 'L1',  ALGO: 'L1', XTZ: 'L1', TRX: 'L1', TON: 'L1',
  BNB: 'L1',  SUI: 'L1',  APT: 'L1', SEI: 'L1', INJ: 'L1',
  HBAR: 'L1', EGLD: 'L1', MINA: 'L1', KAS: 'L1',

  // ── L2 scaling ───────────────────────────────────────────────────
  ARB: 'L2',  OP: 'L2',   STRK: 'L2', BASE: 'L2', MATIC: 'L2',
  POL: 'L2',  MNT: 'L2',  MANTA: 'L2', BLAST: 'L2', METIS: 'L2',
  IMX: 'L2',  ZK: 'L2',   ZKS: 'L2',

  // ── DeFi ─────────────────────────────────────────────────────────
  UNI: 'DeFi', SUSHI: 'DeFi', CAKE: 'DeFi', CRV: 'DeFi', AAVE: 'DeFi',
  COMP: 'DeFi', MKR: 'DeFi', SNX: 'DeFi', LDO: 'DeFi', RPL: 'DeFi',
  PENDLE: 'DeFi', GMX: 'DeFi', DYDX: 'DeFi', JUP: 'DeFi', RAY: 'DeFi',
  CETUS: 'DeFi', VELO: 'DeFi', EIGEN: 'DeFi', ETHFI: 'DeFi', ENA: 'DeFi',
  USUAL: 'DeFi', AERO: 'DeFi', PRIME: 'DeFi', RAD: 'DeFi',

  // ── AI ───────────────────────────────────────────────────────────
  RNDR: 'AI', RENDER: 'AI', FET: 'AI', AGIX: 'AI', OCEAN: 'AI',
  TAO: 'AI',  WLD: 'AI',   AKT: 'AI',  GRT: 'AI',  ICP: 'AI',
  NMR: 'AI',  IO: 'AI',    AIOZ: 'AI', ALI: 'AI',  COOKIE: 'AI',
  VANA: 'AI', AIXBT: 'AI', VIRTUAL: 'AI', AERGO: 'AI',

  // ── Meme ─────────────────────────────────────────────────────────
  DOGE: 'Meme', SHIB: 'Meme', PEPE: 'Meme', WIF: 'Meme', BONK: 'Meme',
  FLOKI: 'Meme', BRETT: 'Meme', PNUT: 'Meme', POPCAT: 'Meme', NEIRO: 'Meme',
  MOG: 'Meme',  GIGA: 'Meme', GOAT: 'Meme', CHILLGUY: 'Meme', MEW: 'Meme',
  FARTCOIN: 'Meme', PUMP: 'Meme', AI16Z: 'AI',  // AI16Z cross-marketed but AI-narrative
  // SPX collides with the index ticker — keep it out to avoid false matches.

  // ── RWA (tokenised real-world assets) ────────────────────────────
  // Note: HBAR and MKR have RWA exposure but are primarily L1 / DeFi
  // (see those sections). We pick a single canonical sector per token.
  ONDO: 'RWA',  POLYX: 'RWA', CFG: 'RWA',
  TRAC: 'RWA',  GFI: 'RWA',   RIO: 'RWA',

  // ── Gaming / SocialFi / Metaverse ───────────────────────────────
  // IMX kept in the L2 section as primary; gaming exposure noted but
  // we don't dual-classify.
  GALA: 'Gaming', SAND: 'Gaming', MANA: 'Gaming', AXS: 'Gaming',
  ENJ: 'Gaming', PIXEL: 'Gaming', BEAM: 'Gaming', RON: 'Gaming',
  APE: 'Gaming', LOOKS: 'Gaming',

  // ── Infra / Oracles / Privacy / DePIN ────────────────────────────
  LINK: 'Infra', BAND: 'Infra', API3: 'Infra', PYTH: 'Infra',
  XLM: 'Infra',  XRP: 'Infra',  HNT: 'Infra',  IOTA: 'Infra',
  FIL: 'Infra',  AR: 'Infra',   STORJ: 'Infra', FLUX: 'Infra',
  QNT: 'Infra',  HONEY: 'Infra', JTO: 'Infra',
  XMR: 'Infra',  ZEC: 'Infra',  DASH: 'Infra',  // privacy
  THETA: 'Infra', TFUEL: 'Infra', LPT: 'Infra',

  // ── Stables ──────────────────────────────────────────────────────
  USDT: 'Stable', USDC: 'Stable', DAI: 'Stable', FDUSD: 'Stable',
  TUSD: 'Stable', PYUSD: 'Stable', USDE: 'Stable', GHO: 'Stable',
  LUSD: 'Stable', FRAX: 'Stable',
}

/** Normalises a token symbol and returns its sector, or 'Other' when unknown. */
export function sectorOf(symbol: string | null | undefined): Sector {
  if (!symbol) return 'Other'
  const key = symbol.toUpperCase().trim()
  return TOKEN_SECTOR[key] ?? 'Other'
}

/** Friendly label per sector for UI rendering. */
export const SECTOR_LABEL: Record<Sector, string> = {
  L1:     'L1 (base layers)',
  L2:     'L2 (scaling)',
  DeFi:   'DeFi',
  AI:     'AI',
  Meme:   'Meme',
  RWA:    'RWA',
  Gaming: 'Gaming / SocialFi',
  Infra:  'Infra / DePIN / Privacy',
  Stable: 'Stablecoins',
  Other:  'Other',
}

/** Short institutional narratives per sector — used when none is supplied. */
export const SECTOR_DEFAULT_NARRATIVE: Record<Sector, string> = {
  L1:     'Capital flowing into base-layer protocols.',
  L2:     'Scaling rollups attracting allocation.',
  DeFi:   'Yield-bearing protocols seeing rotation.',
  AI:     'Compute / agents narrative leadership.',
  Meme:   'Sentiment-driven flows; quality variable.',
  RWA:    'Real-world-asset tokenisation theme.',
  Gaming: 'GameFi / SocialFi capital flows.',
  Infra:  'Oracles / DePIN / privacy infrastructure.',
  Stable: 'Stablecoin supply shifts — dry powder.',
  Other:  'Mixed allocations across smaller themes.',
}
