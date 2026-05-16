/**
 * Trading calculators — pure math, no I/O.
 * Pip value, position sizing, risk-reward, margin.
 */

export function pipSize(pair: string): number {
  const p = pair.toUpperCase()
  if (p.includes('JPY'))   return 0.01
  if (p.startsWith('XAU')) return 0.10
  if (p.startsWith('XAG')) return 0.01
  if (p.startsWith('BTC')) return 1.0
  if (p.startsWith('ETH')) return 0.10
  if (p.startsWith('US30') || p.startsWith('NAS') || p.startsWith('SPX')) return 1.0
  return 0.0001
}

/** USD pip value for 1.0 standard lot (100k units, USD-quoted approx). */
export function pipValuePerLot(pair: string): number {
  const p = pair.toUpperCase()
  if (p.startsWith('XAU')) return 10   // 1 lot gold = $10/pip
  if (p.startsWith('XAG')) return 50
  if (p.startsWith('BTC')) return 1
  if (p.startsWith('ETH')) return 1
  if (p.includes('JPY'))   return 9.1  // ~ for USD/JPY family
  if (p.startsWith('US30') || p.startsWith('NAS')) return 1
  return 10                            // standard FX major
}

export function priceToPips(pair: string, priceDistance: number): number {
  return Math.abs(priceDistance) / pipSize(pair)
}

export interface PositionSizeResult {
  lots:         number
  units:        number
  riskAmount:   number
  pipValue:     number
  slPips:       number
  marginUsd:    number
}

export function calcPositionSize(args: {
  accountBalance: number
  riskPct:        number       // e.g. 1 = 1%
  pair:           string
  entry:          number
  stopLoss:       number
  leverage:       number       // e.g. 100
}): PositionSizeResult {
  const riskAmount = args.accountBalance * (args.riskPct / 100)
  const slPips     = priceToPips(args.pair, args.entry - args.stopLoss)
  const pipVal     = pipValuePerLot(args.pair)
  const rawLots    = slPips > 0 ? riskAmount / (slPips * pipVal) : 0
  const lots       = Math.max(0, Math.round(rawLots * 100) / 100)
  const units      = lots * 100_000
  const notional   = lots * args.entry * (args.pair.startsWith('XAU') ? 100 : 100_000)
  const marginUsd  = args.leverage > 0 ? notional / args.leverage : notional

  return {
    lots,
    units,
    riskAmount: Math.round(riskAmount * 100) / 100,
    pipValue:   pipVal,
    slPips:     Math.round(slPips * 10) / 10,
    marginUsd:  Math.round(marginUsd * 100) / 100,
  }
}

export interface RiskRewardResult {
  riskPips:   number
  rewardPips: number
  ratio:      number
  breakeven:  number    // win-rate % needed to break even
}

export function calcRiskReward(args: {
  pair:       string
  entry:      number
  stopLoss:   number
  takeProfit: number
}): RiskRewardResult {
  const riskPips   = priceToPips(args.pair, args.entry - args.stopLoss)
  const rewardPips = priceToPips(args.pair, args.takeProfit - args.entry)
  const ratio      = riskPips > 0 ? rewardPips / riskPips : 0
  const breakeven  = ratio > 0 ? 100 / (1 + ratio) : 100
  return {
    riskPips:   Math.round(riskPips * 10) / 10,
    rewardPips: Math.round(rewardPips * 10) / 10,
    ratio:      Math.round(ratio * 100) / 100,
    breakeven:  Math.round(breakeven * 10) / 10,
  }
}

export function calcPipValue(args: {
  pair: string
  lots: number
}): { perPip: number; per10Pips: number; per100Pips: number } {
  const perPip = pipValuePerLot(args.pair) * args.lots
  return {
    perPip:     Math.round(perPip * 100) / 100,
    per10Pips:  Math.round(perPip * 10 * 100) / 100,
    per100Pips: Math.round(perPip * 100 * 100) / 100,
  }
}

export const COMMON_PAIRS = [
  'EURUSD','GBPUSD','USDJPY','AUDUSD','USDCAD','USDCHF','NZDUSD',
  'XAUUSD','XAGUSD','BTCUSDT','ETHUSDT','US30','NAS100',
] as const
