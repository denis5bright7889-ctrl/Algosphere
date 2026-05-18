# Dune Provider — Wiring Guide

This adapter executes Dune Analytics queries and maps the rows to the typed
records the Intelligence UI consumes (`SmartMoneyBuy`, `WhaleFlow`,
`ExchangeFlow`, `StablecoinFlow`, `TokenMomentum`).

## Activate the provider

Set these on the **server** (Vercel → Project Settings → Environment Variables,
mark each as *Sensitive*, Production scope):

```env
ONCHAIN_PROVIDER=dune
DUNE_API_KEY=<your-key>

DUNE_QUERY_SMART_MONEY=<numeric-query-id>
DUNE_QUERY_WHALES=<numeric-query-id>
DUNE_QUERY_EXCHANGE_FLOWS=<numeric-query-id>
DUNE_QUERY_STABLECOINS=<numeric-query-id>
DUNE_QUERY_TOKEN_MOMENTUM=<numeric-query-id>
```

You do **not** need to set all five — any surface whose `DUNE_QUERY_*` env is
missing or the API key is absent falls back to the mock provider for that
single method only. Partial wiring is safe.

## Verify a query before wiring

```bash
curl -X POST https://algospherequant.com/api/admin/dune-probe \
  -H 'content-type: application/json' \
  -d '{"query_id": <id>, "mode": "latest", "limit": 5}'
```

(admin email only). Returns the first 5 rows + column list so you can sanity
check the schema matches the contract below.

## Expected column schemas

The normalisers accept the **common variants** for each field (case-insensitive),
so you don't have to rename your Dune columns to ours. Rows missing a required
column are **dropped** — never silently zeroed — so the UI never displays a
fabricated number.

### Smart Money (`DUNE_QUERY_SMART_MONEY`)

| Field | Required | Accepted column names |
|---|---|---|
| chain | yes | `chain`, `blockchain`, `network` (lowercase: ethereum/solana/base/arbitrum/polygon/bsc/optimism) |
| token_symbol | yes | `token_symbol`, `symbol`, `token` |
| token_address | yes | `token_address`, `contract_address`, `address` |
| wallet_address | yes | `wallet_address`, `wallet`, `buyer`, `trader_address` |
| amount_usd | yes | `amount_usd`, `usd_amount`, `usd_value`, `value_usd` |
| observed_at | yes | `observed_at`, `block_time`, `timestamp`, `time` (ISO or epoch s/ms) |
| wallet_label | optional | `wallet_label`, `label`, `wallet_name` |
| price_usd | optional | `price_usd`, `price` |
| conviction | optional | `conviction`, `score`, `quality_score` (0..1 or 0..100; normalised) |
| sector | optional | `sector`, `category`, `narrative` |

### Whale Flows (`DUNE_QUERY_WHALES`)

| Field | Required | Accepted column names |
|---|---|---|
| chain | yes | `chain`, `blockchain`, `network` |
| token_symbol | yes | `token_symbol`, `symbol`, `token` |
| amount_usd | yes | `amount_usd`, `usd_amount`, `usd_value` |
| observed_at | yes | `observed_at`, `block_time`, `timestamp`, `time` |
| direction | conditional | `direction`, `flow_type`, `action` (`in`, `out`, `accumulate`, `distribute`). If absent, inferred from `to_label`. |
| token_address | optional | `token_address`, `contract_address` |
| from_label | optional | `from_label`, `from`, `sender_label` |
| to_label | optional | `to_label`, `to`, `receiver_label` |
| amount_token | optional | `amount_token`, `token_amount`, `amount` (else derived from `amount_usd / price_usd`) |
| is_smart_money | optional | `is_smart_money`, `smart_money`, `sm` |

### Exchange Flows (`DUNE_QUERY_EXCHANGE_FLOWS`)

| Field | Required | Accepted column names |
|---|---|---|
| exchange | yes | `exchange`, `cex`, `venue` |
| chain | yes | `chain`, `blockchain`, `network` |
| flow values | yes (any combination) | `net_flow_usd`/`net_usd`/`net` OR `inflow_usd`/`in_usd`/`usd_in` + `outflow_usd`/`out_usd`/`usd_out` |
| delta_24h_pct | optional | `delta_24h_pct`, `delta_pct`, `change_pct` |

### Stablecoin Liquidity (`DUNE_QUERY_STABLECOINS`)

| Field | Required | Accepted column names |
|---|---|---|
| stable | yes | `stable`, `stablecoin`, `symbol` (one of USDT/USDC/DAI/FDUSD/PYUSD) |
| chain | yes | `chain`, `blockchain`, `network` |
| flow values | yes (any combination) | `net_inflow_usd`/`net_usd`/`net` OR `mint_usd`/`minted_usd`/`mint` + `burn_usd`/`burned_usd`/`burn` |
| delta_supply_pct | optional | `delta_supply_pct`, `supply_delta_pct`, `delta_pct` |

### Token Momentum (`DUNE_QUERY_TOKEN_MOMENTUM`)

| Field | Required | Accepted column names |
|---|---|---|
| chain | yes | `chain`, `blockchain`, `network` |
| token_symbol | yes | `token_symbol`, `symbol`, `token` |
| momentum_score | yes | `momentum_score`, `score` (0..100; clamped) |
| token_address | optional | `token_address`, `contract_address` |
| inflow_usd | optional | `inflow_usd`, `usd_in` |
| volume_delta_pct | optional | `volume_delta_pct`, `vol_delta_pct` |
| wallet_growth_pct | optional | `wallet_growth_pct`, `holder_growth_pct` |
| smart_money_exposure_pct | optional | `smart_money_exposure_pct`, `sm_exposure`, `smart_money_pct` (0..1 or 0..100; normalised) |

## Query parameters

If your Dune query declares the parameters `{{window}}` and/or `{{chains}}`,
they are forwarded automatically — the UI passes whichever the user selected
(`1h`/`24h`/`7d`/`30d` for window, comma-separated chain list for chains).
Parameter-less queries also work; the adapter still applies a client-side
chain filter on the returned rows.

## Caching & cost posture

- `lib/dune.ts` calls `GET /query/<id>/results` (cached results, **no credit
  spent**) and applies `next: { revalidate: 60 }` so identical requests are
  de-duped by the Next.js fetch cache for 60 seconds.
- The query's refresh cadence is controlled on dune.com itself (Query → Schedule).
  Set it to your preferred TTL there (e.g. every 5 min for stablecoins,
  every minute for whale flows).
- No external Redis is required at this layer. Dune already serves cached
  output for `/results` and Next handles in-process de-duping.

## What gets surfaced when the wiring is partial

| Configuration | Behaviour |
|---|---|
| `ONCHAIN_PROVIDER` unset or `mock` | Mock provider used. Source footer reads `mock`. |
| `ONCHAIN_PROVIDER=dune`, `DUNE_API_KEY` missing | Every method throws `ProviderNotWired`; factory falls back per-method to mock. Source footer reads `dune` (but rows are mock). |
| `DUNE_API_KEY` set, only some `DUNE_QUERY_*` set | Configured surfaces serve real Dune data; unconfigured surfaces fall back to mock. |
| All configured | Real Dune everywhere. |

No surface ever returns fabricated values — when nothing is configured the UI
shows the mock provider with its `mock` source label, and the existing
"Provider: …" footer on each Intelligence page tells the user honestly which
source answered.

## AI narratives

`DuneProvider.getNarrative(surface)` is implemented but is **deterministic**:
it aggregates the actual rows we just fetched into a two-sentence factual
observation (totals + top contributor). No LLM, no subjective forecasts. If
the underlying surface has no data the narrative returns `null` and the UI
hides the card.
