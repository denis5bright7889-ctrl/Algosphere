# Adaptive Intelligence Architecture

> Design document for Layer 4 of the Institutional Intelligence transformation.
> **Status**: design only. Implementation is multi-week infrastructure work
> deliberately not built inline with the per-slice product work.

---

## Why this is a design doc, not a slice

The institutional brief calls for an **Adaptive Intelligence** layer
comprising three engines:

- **AI Memory Layer** — system remembers what works / fails / regime behavior
- **Meta-Intelligence Engine** — system evaluates itself, adjusts confidence
- **Strategy Evolution Engine** — adaptive thresholds, dynamic weighting,
  reinforcement of what works in each regime

These are **genuinely multi-week programs**, not features you can ship in a
3-hour slice. They require new persistent storage (vector + event log),
new compute paths (batched evaluation, embedding generation), a learning
loop that's safe to run against live production decisions, and a governance
model so the system can't drift into unsafe territory unattended.

Building them without this design captured first would invite three risks:

1. **Silent drift** — adaptive weights changing without an audit trail of
   why, making post-incident review impossible.
2. **Overfitting** — the system reinforces what worked yesterday and gets
   blindsided by a regime change.
3. **Concept rot** — without explicit "forget" semantics, old patterns
   continue to influence today's decisions long after they stopped working.

This document fixes the architecture so implementation can be safe.

---

## Engine 1 — AI Memory Layer

### What it remembers

| Memory class | Examples | TTL semantics |
|---|---|---|
| **Decision memory** | "On 2026-05-25 we surfaced High Bullish on BTC at $X, in Defensive Environment, with Momentum Trending, SM Bullish, Macro Mixed" | retained indefinitely; decision log is append-only |
| **Outcome memory** | "That decision was followed by +N% in 24h / -M% in 7d" | linked to decision memory, populated by a batch job that closes the loop after the lookahead window |
| **Pattern memory** | "Trending phase + SM Bullish + Defensive Environment historically yields +3.2% over 7d, 64% win rate" | computed view over decision+outcome; rebuilt nightly, never authoritative |
| **Regime memory** | Per-symbol regime trajectory snapshots that informed each decision | retained 90 days; older snapshots roll into aggregates |

### Storage model

Three new Supabase tables (additive, RLS service-role-only — same pattern
as existing engine tables):

```sql
-- Every Intelligence surface that surfaces an opinion writes one row.
intel_decisions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  surface         text NOT NULL,        -- 'conviction' | 'momentum' | 'stress' | …
  symbol          text,                 -- nullable for universe-level surfaces
  payload         jsonb NOT NULL,       -- the full view JSON at decision time
  fingerprint     text NOT NULL,        -- hash of the salient features for grouping
  generated_at    timestamptz NOT NULL DEFAULT now()
)

-- Populated by a nightly batch job that runs T+24h, T+7d after each decision.
intel_outcomes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  decision_id     uuid REFERENCES intel_decisions(id) ON DELETE CASCADE,
  horizon         text NOT NULL,        -- '24h' | '7d'
  realised_return numeric,              -- price-only %; signed
  realised_at     timestamptz NOT NULL,
  notes           jsonb                 -- optional context (regime at outcome, etc.)
)

-- Compact embedding of each decision for nearest-neighbour recall.
intel_embeddings (
  decision_id     uuid PRIMARY KEY REFERENCES intel_decisions(id) ON DELETE CASCADE,
  embedding       vector(384)           -- pgvector — requires pgvector extension
)
```

### Recall API

Memory is **read-only** from the engines that surface opinions. Recall is a
single call:

```ts
// "Given this decision fingerprint, what has historically happened?"
recallSimilar(fingerprint, horizon)
  -> { sample_count, mean_return, p25_return, p75_return, hit_rate }
```

Implemented as a `services/intel-memory/recall.ts` that does an embedding
nearest-neighbour against `intel_embeddings` filtered by surface, then
joins to the outcome rows.

### Honesty rules (consistent with the rest of the platform)

- `sample_count < 12` → the recall returns `{ available: false, reason: 'insufficient_history' }`. Never surfaces a single-sample win rate as a probability.
- Outcomes returned with horizon metadata so the UI can never say "62% win rate" when the underlying lookahead was 24h and the user is reading a swing setup.
- Embeddings are over the **abstract** view (regime/phase/bias labels), not the raw quant features — so memory groups by institutional read, not engine internals.

---

## Engine 2 — Meta-Intelligence Engine

### What it does

The meta layer asks: **how well is each intelligence engine actually doing
in the current regime?** It does NOT make trading decisions; it adjusts how
confident OTHER engines should be in their own output.

Concretely:

- Reads from `intel_decisions` + `intel_outcomes` over the last 30 days.
- Groups outcomes by current regime + originating engine.
- Produces a **trust score** per (engine × regime) pair.
- Conviction Engine reads these trust scores when composing the composite.

### Trust-score derivation

```
trust(engine, regime) = w1 * hit_rate
                     + w2 * |mean_return| - drawdown_penalty
                     + w3 * sample_recency_factor
```

Output bounded to [0.5, 1.5]. The Conviction composer multiplies each
layer's strength by its trust score before aggregation — so an engine that
historically underperforms in Volatile regimes contributes less to the
Conviction read while we're in a Volatile regime.

### Safety rails

- Trust scores **cannot zero out** an engine — minimum 0.5 multiplier so
  a single bad month can't silence a layer entirely.
- Maximum 1.5 multiplier so a hot streak can't dominate the composite.
- Recomputed nightly only — never mid-session, never mid-decision.
- Every trust-score update writes to an `intel_meta_log` audit table.
- A `meta_paused` flag short-circuits the entire layer back to neutral
  (all engines weighted 1.0) if anomaly detection flags suspect outcomes.

### Surface

A new `/intelligence/meta` admin-only page shows the current trust matrix
and the audit log. Regular users never see trust scores directly — they
see Conviction composites that already incorporate them.

---

## Engine 3 — Strategy Evolution Engine

### What it does

The hardest of the three. Allows institutional **strategy parameters** to
adapt to recent regime behavior — but in a constrained, auditable way.

**Adaptive surfaces (initial set, conservative):**

| Parameter | Current | Adaptation | Bound |
|---|---|---|---|
| Conviction composite threshold for "Very High" | 0.7 ratio | ±0.05 from baseline based on recent precision | [0.6, 0.8] |
| Momentum phase classification thresholds | static rules | ±10% from baseline based on regime-conditional accuracy | bounded |
| Stress label cut-offs (45, 70) | static | ±5 absolute from baseline | bounded |

**Non-adaptive (deliberately):** any parameter that affects the execution
kernel, risk gates, or signal-publishing path. Evolution stays in the
intelligence layer.

### Adaptation algorithm

```
NIGHTLY:
  for each adaptive parameter:
    if regime has shifted vs the 30d baseline:
      compute reward = realised intelligence quality with current parameter
      compute reward at parameter ± step
      if a neighbor reward > current by margin:
        propose new value
      else:
        keep current
    write proposal to intel_evolution_proposals table

MANUAL APPROVAL:
  human reviews proposals via admin UI
  approval writes to intel_evolution_active and ages out after 14 days
  unless re-approved
```

Critically, **the system does not auto-apply parameter changes**. Every
adaptation is a proposal that requires explicit approval. This keeps the
moat (the system is adaptive) without forfeiting control (humans gate
every change).

### Storage

```sql
intel_evolution_proposals (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parameter       text NOT NULL,
  current_value   numeric NOT NULL,
  proposed_value  numeric NOT NULL,
  evidence        jsonb NOT NULL,       -- reward comparison, sample sizes
  proposed_at     timestamptz NOT NULL DEFAULT now(),
  status          text NOT NULL DEFAULT 'pending'  -- pending|approved|rejected|expired
)

intel_evolution_active (
  parameter       text PRIMARY KEY,
  active_value    numeric NOT NULL,
  approved_at     timestamptz NOT NULL,
  expires_at      timestamptz NOT NULL,
  approved_by     uuid REFERENCES profiles(id)
)
```

### Read path

The engines that consume adaptive parameters read via a small adapter:

```ts
// Returns active_value if approved + unexpired, else baseline.
activeParam(name: string, baseline: number): number
```

This keeps the consumer logic clean — no engine needs to know whether the
parameter is currently in its baseline or evolved state.

---

## Phased implementation plan

### Phase A — Memory infrastructure (2 weeks)

1. Migrations for `intel_decisions`, `intel_outcomes`, `intel_embeddings`.
2. pgvector extension enabled in Supabase.
3. Decision logging wired into every Intelligence surface that ships an
   opinion (Conviction, Momentum, Stress, Participation, Smart Money).
   Each surface's existing composer writes one row per call.
4. Nightly outcome-resolution job: scans decisions ≥ 24h / ≥ 7d old that
   lack an outcome row, fetches the price at outcome time, writes the
   outcome.
5. Recall API + small `/admin/memory` page to inspect retrieval quality.

**Exit criteria:** every Intelligence surface produces an audit trail; a
spot-check of 20 random decisions has correct outcomes attached.

### Phase B — Meta-Intelligence (2 weeks, depends on A)

1. Nightly trust-score job over the decision+outcome history.
2. Conviction composer modified to read trust scores when composing.
3. `intel_meta_log` audit table + admin page.
4. `meta_paused` kill-switch wired into the composer's read path.

**Exit criteria:** trust scores update overnight; Conviction view shows
the same composite when meta is paused; audit log captures every change.

### Phase C — Strategy Evolution (3 weeks, depends on A + B)

1. Migrations for `intel_evolution_proposals`, `intel_evolution_active`.
2. Nightly proposal job for the conservative initial parameter set.
3. Admin approval UI at `/admin/evolution`.
4. `activeParam()` adapter wired into the consumers (Conviction composite
   thresholds first; momentum/stress thresholds in a follow-up).
5. Auto-expiry job to age out approvals after 14 days.

**Exit criteria:** a proposal lifecycle (propose → approve → consume →
expire) works end-to-end in production; one quarter of read paths
demonstrates measurably better realised outcomes vs baseline.

---

## Cost / dependency considerations

| Resource | Estimate |
|---|---|
| Supabase storage growth | ~5 MB/day for decisions + outcomes, ~30 MB/day with embeddings. Affordable at the platform's current scale. |
| pgvector compute | Negligible for nearest-neighbour over thousands of vectors at the current dimensionality (384). |
| Embedding generation | ~$0.0001/decision via OpenAI embeddings; ~$0.30/day at current decision rate. |
| Engineering | ~7 weeks total across the three phases for one senior engineer. |
| Operational risk | Low for Phase A (pure logging), medium for B (composer behaviour changes), highest for C (parameter changes require human governance). |

---

## What this design **explicitly does not promise**

- It does not promise that the system will get better automatically. It
  promises a structure where improvement is *measurable* and *governable*.
- It does not promise that nearest-neighbour memory recall will return
  statistically robust outcomes — that depends on the decision volume.
  The honesty rule (`sample_count < 12` → unavailable) is the safety net.
- It does not promise that strategy evolution will outperform a static
  baseline. It promises a framework where we can A/B compare evolved vs
  baseline parameters and rollback when evolved underperforms.

---

## When to start implementation

Reasonable triggers:

- Decision volume across Intelligence surfaces ≥ 500/day for 30+ days.
  Below that, memory has too little to learn from.
- At least one production cycle's worth of regime variation captured
  (so memory has examples from Trending, Ranging, Volatile, etc.).
- A clear product question this layer answers: e.g. "we keep getting
  caught long in Defensive Environments" → Meta-Intelligence
  trust-scoring would catch this systematically.

Premature implementation risks building infrastructure that learns from
noise. The current per-slice intelligence work (Conviction / Momentum /
Stress / Participation) is exactly what creates the decision volume this
layer would learn from.

---

## References within the codebase

- Conviction composer: `apps/web/src/lib/conviction.ts`
- Momentum engine: `apps/web/src/lib/momentum-engine.ts`
- Stress engine: `apps/web/src/lib/stress-engine.ts`
- Participation engine: `apps/web/src/lib/participation-engine.ts`
- Nansen client: `apps/web/src/lib/nansen.ts`
- Macro client: `apps/web/src/lib/alphavantage.ts`
- Regime classifier: `apps/signal-engine/regime/classifier.py`

These six modules are the producers of the decisions that the Adaptive
Intelligence layer would learn from. They were deliberately built first.
