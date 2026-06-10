'use client'

/**
 * AddTradeModal — Journal V3 (Behavioral Trading Intelligence System).
 *
 * Replaces the thin "entry/exit/PnL" form with a five-section flow:
 *   1. Core           — Pair, direction, prices, sizing, date
 *   2. Strategy       — Strategy used, setup validity, regime, session  (REQUIRED)
 *   3. Psychology     — Emotion-pre, reason-for-entry, revenge, rule    (REQUIRED)
 *                       compliance, confidence
 *   4. Execution      — Entry / Exit / Management quality               (optional)
 *   5. Thesis         — Why this works, what confirmed, what would      (optional)
 *                       invalidate, post-trade reflection
 *
 * The form refuses to submit until Strategy + Psychology are complete.
 * On save the API runs the deterministic evaluator and returns 5
 * process grades + 3+ insights — the journal becomes a behavioral
 * intelligence event, not a log entry.
 */

import { useMemo, useState } from 'react'
import { X, CheckCircle2, Circle, AlertCircle } from 'lucide-react'
import type { JournalEntry } from '@/lib/types'
import type { CoachEvalSummary } from './JournalClient'
import { cn } from '@/lib/utils'

interface Props {
  userId: string
  onAdded: (entry: JournalEntry, coach?: CoachEvalSummary) => void
  onClose: () => void
  /** When present, the modal opens in EDIT mode — pre-fills the form
   *  from this entry and submits a PATCH instead of a POST. */
  editEntry?: JournalEntry | null
}

const SETUP_TAGS = ['breakout', 'trend', 'reversal', 'range', 'news', 'scalp'] as const

const STRATEGY_OPTIONS = [
  { value: 'trend_following', label: 'Trend Following' },
  { value: 'breakout',        label: 'Breakout' },
  { value: 'scalping',        label: 'Scalping' },
  { value: 'swing',           label: 'Swing' },
  { value: 'smc',             label: 'SMC' },
  { value: 'mean_reversion',  label: 'Mean Reversion' },
  { value: 'news',            label: 'News' },
  { value: 'custom',          label: 'Custom' },
] as const

const REGIME_OPTIONS = [
  { value: 'trending',       label: 'Trending' },
  { value: 'ranging',        label: 'Ranging' },
  { value: 'volatile',       label: 'Volatile' },
  { value: 'reversal',       label: 'Reversal' },
  { value: 'low_liquidity',  label: 'Low Liquidity' },
] as const

const SESSION_OPTIONS = [
  { value: 'london',    label: 'London' },
  { value: 'new_york',  label: 'New York' },
  { value: 'asia',      label: 'Asia' },
  { value: 'overlap',   label: 'Overlap' },
  { value: 'off_hours', label: 'Off-hours' },
] as const

const EMOTION_OPTIONS = [
  { value: 'calm',        label: 'Calm' },
  { value: 'focused',     label: 'Focused' },
  { value: 'confident',   label: 'Confident' },
  { value: 'anxious',     label: 'Anxious' },
  { value: 'frustrated',  label: 'Frustrated' },
  { value: 'excited',     label: 'Excited' },
  { value: 'fearful',     label: 'Fearful' },
] as const

const REASON_OPTIONS = [
  { value: 'strategy_signal',     label: 'Strategy Signal' },
  { value: 'confirmation_setup',  label: 'Confirmation Setup' },
  { value: 'news',                label: 'News' },
  { value: 'impulse',             label: 'Impulse' },
  { value: 'fomo',                label: 'FOMO' },
] as const

const RULE_COMPLIANCE_OPTIONS = [
  { value: 'full',    label: '100% (Full)' },
  { value: 'partial', label: 'Partial' },
  { value: 'none',    label: 'No' },
] as const

const QUALITY_OPTIONS = [
  { value: 'excellent', label: 'Excellent' },
  { value: 'good',      label: 'Good' },
  { value: 'average',   label: 'Average' },
  { value: 'poor',      label: 'Poor' },
] as const

const SETUP_VALIDITY_OPTIONS = [
  { value: 'yes',     label: 'Yes' },
  { value: 'partial', label: 'Partial' },
  { value: 'no',      label: 'No' },
] as const

interface FormState {
  // Core
  pair:        string
  direction:   'buy' | 'sell'
  trade_date:  string
  entry_price: string
  exit_price:  string
  lot_size:    string
  pips:        string
  pnl:         string
  risk_amount: string
  risk_pct:    string
  setup_tag:   string

  // Strategy (required)
  strategy_used:  string
  setup_validity: string
  market_regime:  string
  session:        string

  // Psychology (required)
  emotion_pre:      string
  reason_for_entry: string
  revenge_trade:    boolean
  rule_compliance:  string
  confidence_level: number

  // Execution (optional)
  entry_quality:      string
  exit_quality:       string
  management_quality: string

  // Thesis (optional)
  thesis:             string
  entry_confirmation: string
  invalidations:      string
  reflection:         string
}

const INITIAL_FORM: FormState = {
  pair: '', direction: 'buy', trade_date: new Date().toISOString().slice(0, 10),
  entry_price: '', exit_price: '', lot_size: '', pips: '', pnl: '',
  risk_amount: '', risk_pct: '', setup_tag: '',
  strategy_used: '', setup_validity: '', market_regime: '', session: '',
  emotion_pre: '', reason_for_entry: '', revenge_trade: false,
  rule_compliance: '', confidence_level: 5,
  entry_quality: '', exit_quality: '', management_quality: '',
  thesis: '', entry_confirmation: '', invalidations: '', reflection: '',
}

type SectionKey = 'core' | 'strategy' | 'psychology' | 'execution' | 'thesis'

export default function AddTradeModal({ onAdded, onClose, editEntry }: Props) {
  // Edit-mode seed: hydrate the form from the passed entry. String
  // coercion mirrors the input fields' types (the form holds strings,
  // the API expects numbers — handleSubmit re-parses).
  const isEdit = Boolean(editEntry)
  const seedForm = useMemo<FormState>(() => {
    if (!editEntry) return INITIAL_FORM
    const e = editEntry as unknown as Record<string, unknown>
    const str = (v: unknown) => v == null ? '' : String(v)
    return {
      pair:        str(e.pair),
      direction:   (e.direction === 'sell' ? 'sell' : 'buy'),
      trade_date:  typeof e.trade_date === 'string' ? e.trade_date : new Date().toISOString().slice(0, 10),
      entry_price: str(e.entry_price),
      exit_price:  str(e.exit_price),
      lot_size:    str(e.lot_size),
      pips:        str(e.pips),
      pnl:         str(e.pnl),
      risk_amount: str(e.risk_amount),
      risk_pct:    str(e.risk_pct),
      setup_tag:   str(e.setup_tag),
      strategy_used:    str(e.strategy_used),
      setup_validity:   str(e.setup_validity),
      market_regime:    str(e.market_regime),
      session:          str(e.session),
      emotion_pre:      str(e.emotion_pre),
      reason_for_entry: str(e.reason_for_entry),
      revenge_trade:    e.revenge_trade === true,
      rule_compliance:  str(e.rule_compliance),
      confidence_level: typeof e.confidence_level === 'number' ? e.confidence_level : 5,
      entry_quality:      str(e.entry_quality),
      exit_quality:       str(e.exit_quality),
      management_quality: str(e.management_quality),
      thesis:             str(e.thesis),
      entry_confirmation: str(e.entry_confirmation),
      invalidations:      str(e.invalidations),
      reflection:         str(e.reflection),
    }
  }, [editEntry])

  const [form, setForm]     = useState<FormState>(seedForm)
  const [section, setSection] = useState<SectionKey>('core')
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  // Per-section completeness — drives the stepper + the submit gate.
  const completeness = useMemo(() => ({
    core: form.pair.trim().length > 0 && Boolean(form.trade_date),
    strategy: Boolean(form.strategy_used && form.setup_validity && form.market_regime && form.session),
    psychology: Boolean(form.emotion_pre && form.reason_for_entry && form.rule_compliance) && form.confidence_level >= 1,
    execution: true,  // optional
    thesis: true,     // optional
  }), [form])

  const canSubmit = completeness.core && completeness.strategy && completeness.psychology

  async function handleSubmit() {
    setError(null)
    if (!canSubmit) {
      setError('Strategy + Psychology context are required to save a trade.')
      return
    }
    setLoading(true)
    try {
      const body = {
        pair:        form.pair,
        direction:   form.direction,
        trade_date:  form.trade_date,
        entry_price: form.entry_price ? parseFloat(form.entry_price) : undefined,
        exit_price:  form.exit_price  ? parseFloat(form.exit_price)  : undefined,
        lot_size:    form.lot_size    ? parseFloat(form.lot_size)    : undefined,
        pips:        form.pips        ? parseFloat(form.pips)        : undefined,
        pnl:         form.pnl         ? parseFloat(form.pnl)         : undefined,
        risk_amount: form.risk_amount ? parseFloat(form.risk_amount) : undefined,
        risk_pct:    form.risk_pct    ? parseFloat(form.risk_pct)    : undefined,
        setup_tag:   form.setup_tag || undefined,

        strategy_used:  form.strategy_used,
        setup_validity: form.setup_validity,
        market_regime:  form.market_regime,
        session:        form.session,

        emotion_pre:      form.emotion_pre,
        reason_for_entry: form.reason_for_entry,
        revenge_trade:    form.revenge_trade,
        rule_compliance:  form.rule_compliance,
        confidence_level: form.confidence_level,

        entry_quality:      form.entry_quality      || undefined,
        exit_quality:       form.exit_quality       || undefined,
        management_quality: form.management_quality || undefined,

        thesis:             form.thesis             || undefined,
        entry_confirmation: form.entry_confirmation || undefined,
        invalidations:      form.invalidations      || undefined,
        reflection:         form.reflection         || undefined,
      }

      const res = isEdit && editEntry
        ? await fetch(`/api/journal/${editEntry.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          })
        : await fetch('/api/journal', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          })
      const json = await res.json()
      if (!res.ok) {
        setError(json.error ?? 'Save failed')
        setLoading(false)
        return
      }
      onAdded(json.data as JournalEntry, json.coach as CoachEvalSummary | undefined)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed')
      setLoading(false)
    }
  }

  const sections: { key: SectionKey; label: string; required: boolean }[] = [
    { key: 'core',       label: 'Core',       required: true  },
    { key: 'strategy',   label: 'Strategy',   required: true  },
    { key: 'psychology', label: 'Psychology', required: true  },
    { key: 'execution',  label: 'Execution',  required: false },
    { key: 'thesis',     label: 'Thesis',     required: false },
  ]

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative z-10 w-full max-w-2xl rounded-t-2xl sm:rounded-2xl bg-card border border-border shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-border">
          <div>
            <h2 className="text-base font-bold">{isEdit ? 'Edit trade' : 'Log a trade'}</h2>
            <p className="text-[11px] text-muted-foreground">
              {isEdit
                ? 'Saving will re-grade the trade with the deterministic coach.'
                : 'Each entry generates 5 process grades + 3+ AI insights — no PnL grading.'}
            </p>
          </div>
          <button type="button" aria-label="Close" onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-5 w-5" strokeWidth={1.75} aria-hidden />
          </button>
        </div>

        {/* Stepper */}
        <div className="border-b border-border bg-background/40 px-3 py-2 overflow-x-auto">
          <ol className="flex gap-1 min-w-max">
            {sections.map((s) => {
              const done   = completeness[s.key]
              const active = section === s.key
              return (
                <li key={s.key}>
                  <button
                    type="button"
                    onClick={() => setSection(s.key)}
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11px] font-semibold transition',
                      active
                        ? 'bg-amber-500/15 text-amber-300 border border-amber-500/40'
                        : done
                          ? 'text-foreground/85 hover:bg-accent/40'
                          : 'text-muted-foreground hover:bg-accent/40',
                    )}
                  >
                    {done
                      ? <CheckCircle2 className="h-3 w-3 text-emerald-400" strokeWidth={2.5} aria-hidden />
                      : <Circle       className="h-3 w-3" strokeWidth={2} aria-hidden />}
                    {s.label}
                    {s.required && !done && (
                      <span className="text-rose-300/85">*</span>
                    )}
                  </button>
                </li>
              )
            })}
          </ol>
        </div>

        {/* Section body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {section === 'core'       && <CoreSection       form={form} update={update} />}
          {section === 'strategy'   && <StrategySection   form={form} update={update} />}
          {section === 'psychology' && <PsychologySection form={form} update={update} />}
          {section === 'execution'  && <ExecutionSection  form={form} update={update} />}
          {section === 'thesis'     && <ThesisSection     form={form} update={update} />}
        </div>

        {/* Footer */}
        <div className="border-t border-border bg-background/40 px-5 py-3 space-y-2">
          {error && (
            <div className="flex items-center gap-1.5 rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-1.5 text-[12px] text-rose-200">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden />
              {error}
            </div>
          )}
          {!canSubmit && !error && (
            <p className="text-[11px] text-amber-300/85">
              Complete <strong>Strategy</strong> and <strong>Psychology</strong> sections to save.
            </p>
          )}
          <div className="flex items-center justify-between gap-2">
            <button type="button" onClick={onClose}
              className="rounded-md border border-border px-4 py-2 text-sm font-medium hover:bg-accent">
              Cancel
            </button>
            <div className="flex gap-2">
              <NavStep direction="prev" section={section} setSection={setSection} sections={sections} />
              <NavStep direction="next" section={section} setSection={setSection} sections={sections} />
              <button
                type="button"
                onClick={handleSubmit}
                disabled={loading || !canSubmit}
                className={cn(
                  'rounded-md bg-gradient-primary px-4 py-2 text-sm font-semibold text-black hover:opacity-90',
                  (loading || !canSubmit) && 'opacity-50 cursor-not-allowed',
                )}
              >
                {loading ? 'Saving…' : isEdit ? 'Save changes' : 'Save trade'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}


// ─── Sections ─────────────────────────────────────────────────────

interface SectionProps {
  form: FormState
  update: <K extends keyof FormState>(key: K, value: FormState[K]) => void
}

function CoreSection({ form, update }: SectionProps) {
  return (
    <div className="space-y-3">
      <SectionHeader title="Core trade data" />
      <div className="grid grid-cols-2 gap-3">
        <Field label="Pair *">
          <input required placeholder="XAUUSD" aria-label="Pair" value={form.pair}
            onChange={(e) => update('pair', e.target.value.toUpperCase())}
            className={inputCls} />
        </Field>
        <Field label="Date *">
          <input required type="date" aria-label="Trade date" value={form.trade_date}
            onChange={(e) => update('trade_date', e.target.value)} className={inputCls} />
        </Field>
      </div>
      <Field label="Direction *">
        <div className="grid grid-cols-2 gap-2">
          {(['buy', 'sell'] as const).map((d) => (
            <button key={d} type="button" aria-label={`Direction ${d}`} onClick={() => update('direction', d)}
              className={cn(
                'rounded-md border px-3 py-2 text-sm font-semibold capitalize',
                form.direction === d
                  ? d === 'buy'
                    ? 'bg-emerald-600 text-white border-emerald-600'
                    : 'bg-rose-600    text-white border-rose-600'
                  : 'border-border hover:bg-accent',
              )}>
              {d}
            </button>
          ))}
        </div>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Entry price"><input type="number" step="any" aria-label="Entry price" value={form.entry_price}
          onChange={(e) => update('entry_price', e.target.value)} className={inputCls} /></Field>
        <Field label="Exit price"><input type="number" step="any" aria-label="Exit price" value={form.exit_price}
          onChange={(e) => update('exit_price', e.target.value)} className={inputCls} /></Field>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Field label="Lot size"><input type="number" step="any" aria-label="Lot size" value={form.lot_size}
          onChange={(e) => update('lot_size', e.target.value)} className={inputCls} /></Field>
        <Field label="Pips"><input type="number" step="any" aria-label="Pips" value={form.pips}
          onChange={(e) => update('pips', e.target.value)} className={inputCls} /></Field>
        <Field label="P&L ($)"><input type="number" step="any" aria-label="Profit and loss" value={form.pnl}
          onChange={(e) => update('pnl', e.target.value)} className={inputCls} /></Field>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Field label="Risk amount ($)"><input type="number" step="any" aria-label="Risk amount" value={form.risk_amount}
          onChange={(e) => update('risk_amount', e.target.value)} className={inputCls} /></Field>
        <Field label="Risk %"><input type="number" step="0.01" aria-label="Risk percent" value={form.risk_pct}
          onChange={(e) => update('risk_pct', e.target.value)} className={inputCls} placeholder="1.0" /></Field>
        <Field label="Setup tag">
          <select value={form.setup_tag} aria-label="Setup tag"
            onChange={(e) => update('setup_tag', e.target.value)} className={inputCls}>
            <option value="">— none —</option>
            {SETUP_TAGS.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </Field>
      </div>
    </div>
  )
}

function StrategySection({ form, update }: SectionProps) {
  return (
    <div className="space-y-3">
      <SectionHeader title="Strategy context"
        subtitle="Required. Drives the strategy + timing intelligence engines." />
      <Field label="Strategy used *">
        <ChoiceGrid value={form.strategy_used} options={STRATEGY_OPTIONS}
          onChange={(v) => update('strategy_used', v)} cols={2} />
      </Field>
      <Field label="Setup validity *">
        <ChoiceGrid value={form.setup_validity} options={SETUP_VALIDITY_OPTIONS}
          onChange={(v) => update('setup_validity', v)} cols={3} />
      </Field>
      <Field label="Market regime *">
        <ChoiceGrid value={form.market_regime} options={REGIME_OPTIONS}
          onChange={(v) => update('market_regime', v)} cols={3} />
      </Field>
      <Field label="Session *">
        <ChoiceGrid value={form.session} options={SESSION_OPTIONS}
          onChange={(v) => update('session', v)} cols={3} />
      </Field>
    </div>
  )
}

function PsychologySection({ form, update }: SectionProps) {
  return (
    <div className="space-y-3">
      <SectionHeader title="Psychology context"
        subtitle="Required. The journal that ignores emotion is a log, not intelligence." />
      <Field label="Emotional state before entry *">
        <ChoiceGrid value={form.emotion_pre} options={EMOTION_OPTIONS}
          onChange={(v) => update('emotion_pre', v)} cols={2} />
      </Field>
      <Field label="Reason for entry *">
        <ChoiceGrid value={form.reason_for_entry} options={REASON_OPTIONS}
          onChange={(v) => update('reason_for_entry', v)} cols={2} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Revenge trade *">
          <div className="grid grid-cols-2 gap-2">
            {[{ v: false, l: 'No' }, { v: true, l: 'Yes' }].map((o) => (
              <button key={o.l} type="button" onClick={() => update('revenge_trade', o.v)}
                className={cn(
                  'rounded-md border px-3 py-2 text-sm font-semibold',
                  form.revenge_trade === o.v
                    ? o.v ? 'bg-rose-500/20 text-rose-300 border-rose-500/40'
                          : 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40'
                    : 'border-border hover:bg-accent',
                )}>{o.l}</button>
            ))}
          </div>
        </Field>
        <Field label="Rule compliance *">
          <ChoiceGrid value={form.rule_compliance} options={RULE_COMPLIANCE_OPTIONS}
            onChange={(v) => update('rule_compliance', v)} cols={3} />
        </Field>
      </div>
      <Field label={`Confidence level: ${form.confidence_level}/10 *`}>
        <input type="range" min={1} max={10} step={1}
          aria-label="Confidence level"
          value={form.confidence_level}
          onChange={(e) => update('confidence_level', Number(e.target.value))}
          className="w-full accent-amber-400" />
        <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
          <span>1 — Hesitant</span><span>5 — Steady</span><span>10 — Strong conviction</span>
        </div>
      </Field>
    </div>
  )
}

function ExecutionSection({ form, update }: SectionProps) {
  return (
    <div className="space-y-3">
      <SectionHeader title="Execution quality"
        subtitle="Optional. Tells the coach how the trade was opened, managed, and closed." />
      <Field label="Entry quality">
        <ChoiceGrid value={form.entry_quality} options={QUALITY_OPTIONS}
          onChange={(v) => update('entry_quality', v)} cols={4} />
      </Field>
      <Field label="Exit quality">
        <ChoiceGrid value={form.exit_quality} options={QUALITY_OPTIONS}
          onChange={(v) => update('exit_quality', v)} cols={4} />
      </Field>
      <Field label="Trade management quality">
        <ChoiceGrid value={form.management_quality} options={QUALITY_OPTIONS}
          onChange={(v) => update('management_quality', v)} cols={4} />
      </Field>
    </div>
  )
}

function ThesisSection({ form, update }: SectionProps) {
  return (
    <div className="space-y-3">
      <SectionHeader title="Thesis & reflection"
        subtitle="Optional but high-leverage. Replaces free-form notes with structured prompts the coach can read." />
      <Field label='Trade thesis — "Why should this trade work?"'>
        <textarea rows={3} aria-label="Trade thesis" value={form.thesis} placeholder="The setup conditions and what the strategy expects to play out."
          onChange={(e) => update('thesis', e.target.value)} className={cn(inputCls, 'resize-none')} />
      </Field>
      <Field label='Entry confirmation — "What evidence supported entry?"'>
        <textarea rows={2} aria-label="Entry confirmation" value={form.entry_confirmation} placeholder="Specific signals or confluence that justified the trigger."
          onChange={(e) => update('entry_confirmation', e.target.value)} className={cn(inputCls, 'resize-none')} />
      </Field>
      <Field label='Invalidations — "What would prove this trade wrong?"'>
        <textarea rows={2} aria-label="Invalidations" value={form.invalidations} placeholder="The level or signal that says the thesis is broken."
          onChange={(e) => update('invalidations', e.target.value)} className={cn(inputCls, 'resize-none')} />
      </Field>
      <Field label='Post-trade reflection — "What would you improve next time?"'>
        <textarea rows={3} aria-label="Post-trade reflection" value={form.reflection} placeholder="Honest read on what worked and what to tighten."
          onChange={(e) => update('reflection', e.target.value)} className={cn(inputCls, 'resize-none')} />
      </Field>
    </div>
  )
}


// ─── Primitives ───────────────────────────────────────────────────

function SectionHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <header className="border-b border-border/40 pb-2">
      <h3 className="text-sm font-semibold">{title}</h3>
      {subtitle && <p className="mt-0.5 text-[11px] text-muted-foreground">{subtitle}</p>}
    </header>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-[11px] font-medium text-muted-foreground">{label}</label>
      {children}
    </div>
  )
}

function ChoiceGrid<V extends string>({
  value, options, onChange, cols = 2,
}: {
  value: string
  options: readonly { value: V; label: string }[]
  onChange: (v: V) => void
  cols?: 2 | 3 | 4
}) {
  const gridCls =
    cols === 2 ? 'grid-cols-2' :
    cols === 3 ? 'grid-cols-3' :
    'grid-cols-2 sm:grid-cols-4'
  return (
    <div className={cn('grid gap-1.5', gridCls)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cn(
            'rounded-md border px-2.5 py-1.5 text-[12px] font-medium transition',
            value === o.value
              ? 'border-amber-500/50 bg-amber-500/15 text-amber-200'
              : 'border-border text-foreground/85 hover:bg-accent/40',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

function NavStep({
  direction, section, setSection, sections,
}: {
  direction: 'prev' | 'next'
  section: SectionKey
  setSection: (s: SectionKey) => void
  sections: { key: SectionKey }[]
}) {
  const idx = sections.findIndex((s) => s.key === section)
  const next = direction === 'next'
    ? sections[idx + 1]?.key
    : sections[idx - 1]?.key
  if (!next) return null
  return (
    <button
      type="button"
      onClick={() => setSection(next)}
      className="hidden sm:inline-flex rounded-md border border-border px-3 py-2 text-xs font-semibold hover:bg-accent"
    >
      {direction === 'prev' ? '← Prev' : 'Next →'}
    </button>
  )
}

const inputCls = 'w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/40'
