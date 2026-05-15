// =============================================================================
// AlgoSphere Quant — Signal Lifecycle State Machine
// =============================================================================

import type { SignalLifecycleState, SignalResult } from '@/lib/types'

export const LIFECYCLE_TRANSITIONS: Record<SignalLifecycleState, SignalLifecycleState[]> = {
  pending:     ['queued', 'invalidated'],
  queued:      ['active', 'invalidated', 'expired'],
  active:      ['tp1_hit', 'stopped', 'invalidated', 'breakeven'],
  tp1_hit:     ['tp2_hit', 'stopped', 'breakeven'],
  tp2_hit:     ['tp3_hit', 'stopped', 'breakeven'],
  tp3_hit:     [],
  stopped:     [],
  invalidated: [],
  expired:     [],
  breakeven:   [],
}

export const TERMINAL_STATES: SignalLifecycleState[] = [
  'tp3_hit', 'stopped', 'invalidated', 'expired', 'breakeven',
]

export const LIFECYCLE_TO_RESULT: Partial<Record<SignalLifecycleState, SignalResult>> = {
  tp1_hit:  'win',
  tp2_hit:  'win',
  tp3_hit:  'win',
  stopped:  'loss',
  breakeven: 'breakeven',
}

export function canTransition(from: SignalLifecycleState, to: SignalLifecycleState): boolean {
  return LIFECYCLE_TRANSITIONS[from]?.includes(to) ?? false
}

export function isTerminal(state: SignalLifecycleState): boolean {
  return TERMINAL_STATES.includes(state)
}

export const LIFECYCLE_LABELS: Record<SignalLifecycleState, string> = {
  pending:     'Pending',
  queued:      'Queued',
  active:      'Active',
  tp1_hit:     'TP1 Hit',
  tp2_hit:     'TP2 Hit',
  tp3_hit:     'TP3 Hit ✦',
  stopped:     'Stopped Out',
  invalidated: 'Invalidated',
  expired:     'Expired',
  breakeven:   'Breakeven',
}

export const LIFECYCLE_COLORS: Record<SignalLifecycleState, string> = {
  pending:     'bg-gray-100 text-gray-600',
  queued:      'bg-blue-100 text-blue-700',
  active:      'bg-emerald-100 text-emerald-700',
  tp1_hit:     'bg-green-200 text-green-800',
  tp2_hit:     'bg-green-400 text-white',
  tp3_hit:     'bg-green-600 text-white',
  stopped:     'bg-red-100 text-red-700',
  invalidated: 'bg-orange-100 text-orange-700',
  expired:     'bg-gray-200 text-gray-500',
  breakeven:   'bg-yellow-100 text-yellow-700',
}

// Determine if a lifecycle state counts as a "win" for analytics
export function isWinState(state: SignalLifecycleState): boolean {
  return ['tp1_hit', 'tp2_hit', 'tp3_hit'].includes(state)
}

export function isLossState(state: SignalLifecycleState): boolean {
  return state === 'stopped'
}
