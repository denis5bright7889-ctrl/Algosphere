# AlgoSphere — MT5 Bridge (Windows VPS)

Small FastAPI service that lets the Railway (Linux) signal-engine
route MetaTrader 5 orders to an MT5 terminal running on a Windows
VPS. Without this service, MT5 connections on `/brokers` stay
`DISABLED` because the `MetaTrader5` Python package is Windows-only.

The bridge runs in **two modes simultaneously** — they share the
same MT5 plumbing:

- **Multi-tenant** (default): every endpoint accepts login/password/server
  in the request body. The Railway engine's `MT5BridgeAdapter` uses
  this path and re-logs the terminal per call.
- **Single-account** (opt-in via `MT5_LOGIN/PASSWORD/SERVER` in `.env`):
  unlocks `GET /account`, `GET /positions`, `POST /trade/place`,
  `POST /trade/close`. Also starts the watchdog (pings MT5 every 30s)
  and surfaces account state on `GET /health`.

## Topology

```
Railway (Linux) engine
        │
        │  HTTPS, X-Bridge-Key auth
        ▼
This bridge service (Windows)  ──▶  MT5 terminal (logged into broker)
```

## Requirements

- **Windows Server 2019/2022** or **Windows 10/11** VPS.
- Minimum 2 vCPU, 4 GB RAM, 20 GB disk.
- A broker that supports MT5 (Pepperstone, IC Markets, FTMO, etc.) —
  demo account works for testnet.
- A way to expose the bridge over HTTPS. We recommend Cloudflare
  Tunnel because it requires zero firewall changes, zero TLS config,
  and is free.

---

## Setup — step by step

### 1. Install MetaTrader 5 terminal

1. Download the MT5 installer from your broker's website (NOT
   metatrader.com — broker-bundled installers configure the right
   server presets automatically).
2. Run the installer with defaults.
3. Launch MT5, log into your **demo** account first
   (File → Login to Trade Account). Save the login details — you'll
   need the numeric login, password, and the exact server name
   (e.g. `Pepperstone-Demo`, case-sensitive).
4. Verify the terminal connects: bottom-right of MT5 should show
   `<latency> ms` and a green `Connected` indicator.

### 2. Install Python 3.11+

1. Download from <https://python.org/downloads/windows/>.
2. **Check "Add Python to PATH"** during install.
3. Open PowerShell and verify:
   ```powershell
   python --version
   pip --version
   ```

### 3. Clone the repo + install the bridge

```powershell
git clone https://github.com/denis5bright7889-ctrl/Algosphere.git
cd Algosphere\apps\mt5-bridge
pip install -r requirements.txt
```

### 4. Create the bridge API key

```powershell
python -c "import secrets; print(secrets.token_urlsafe(32))"
```

Copy the output — you'll paste it into TWO places: the bridge's
`.env` (next step) and the Railway engine's `MT5_BRIDGE_API_KEY` env
var (step 7).

### 5. Configure the bridge

```powershell
copy .env.example .env
notepad .env
```

Fill in:

```
BRIDGE_API_KEY=<the secret from step 4>
MT5_PIN_LOGIN=true     # if you only ever serve ONE broker account, faster
```

You do NOT put broker credentials in `.env`. The Railway engine
passes them per-request from the user's encrypted
`broker_connections` row.

### 6. Test the bridge locally

```powershell
uvicorn bridge:app --host 0.0.0.0 --port 8000
```

In another shell:
```powershell
curl http://localhost:8000/health
```

You should see `{"status":"ok","mt5_loaded":true,...}`. If
`mt5_loaded` is `false`, the `MetaTrader5` package failed to import —
re-run `pip install MetaTrader5` and check the error.

### 7. Expose with Cloudflare Tunnel (free, no firewall config)

Stop the bridge first (Ctrl+C). Then:

1. Install `cloudflared`:
   ```powershell
   winget install --id Cloudflare.cloudflared
   ```
2. Quick tunnel (no Cloudflare account required, ephemeral URL):
   ```powershell
   cloudflared tunnel --url http://localhost:8000
   ```
   This prints a permanent `https://<random>.trycloudflare.com` URL.
   That URL is your `MT5_BRIDGE_URL`.

   **For production**, set up a named tunnel with your own domain —
   see <https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/get-started/create-remote-tunnel/>
   . The named-tunnel URL is stable across `cloudflared` restarts.

3. Open a second PowerShell and start the bridge:
   ```powershell
   cd Algosphere\apps\mt5-bridge
   uvicorn bridge:app --host 0.0.0.0 --port 8000
   ```

### 8. Configure the Railway engine

In the Railway dashboard for the `Algosphere` project's `algosphere`
service → Variables, add:

```
MT5_BRIDGE_URL=https://<your-trycloudflare-or-named-tunnel-url>
MT5_BRIDGE_API_KEY=<the same secret from step 4>
```

Click **Redeploy** so the new env vars take effect. The engine will
pick up the new vars within ~30 seconds of deploy completion.

### 9. Verify end-to-end on /brokers

1. Open <https://algospherequant.com/brokers>.
2. Your MT5 row that previously showed `DISABLED` should automatically
   re-evaluate on the next 10-minute probe — or click **Retry connection**
   for instant verdict.
3. Status should flip to `CONNECTED` with your live equity displayed.

If it stays FAILED, the error message names the cause. Common ones:

| Error message | Fix |
|---|---|
| `bridge unreachable: ConnectError` | Tunnel down. Restart `cloudflared`. |
| `bridge /connect 401: Invalid bridge key` | `MT5_BRIDGE_API_KEY` mismatch between Railway and `.env`. |
| `login failed: (-6, 'Authorization failed')` | MT5 credentials wrong, or server name doesn't match exactly. |
| `account_info returned None` | Terminal isn't logged in — open MT5 manually and log in once. |

---

## Run as a Windows service (production)

For production, run both `cloudflared` and `uvicorn` as auto-start
Windows services so they survive reboots:

```powershell
# As Administrator
sc create AlgoMT5Bridge binPath= "C:\Path\To\Python\python.exe -m uvicorn bridge:app --host 0.0.0.0 --port 8000" start= auto
sc create CloudflaredTunnel binPath= "C:\Program Files (x86)\cloudflared\cloudflared.exe tunnel run <YOUR_TUNNEL_NAME>" start= auto
```

Or use [NSSM](https://nssm.cc/) for a friendlier wrapper.

---

## Security notes

- **Every request requires `X-Bridge-Key`.** Without the header (or
  with the wrong value) all endpoints return 401 / 503. Don't expose
  the bridge without setting `BRIDGE_API_KEY`.
- **Passwords travel in request bodies.** Always run behind HTTPS —
  never expose port 8000 directly to the internet. Cloudflare Tunnel
  is the simplest path. Alternatives: nginx + Let's Encrypt; Tailscale;
  WireGuard.
- **Rotate the API key** if the Railway engine is ever redeployed
  from a forked branch or if the VPS is shared. Regenerate, update
  `.env`, restart bridge, update Railway env var, redeploy engine.
- **Withdraw permissions** in the MT5 broker account should be
  disabled — the bridge can place trades but should never be able to
  initiate withdrawals.

## Endpoint reference

All endpoints (except `GET /health`) require the `X-Bridge-Key` header.

### Multi-tenant (creds in body) — used by the Railway engine

| Method | Path | Purpose |
|---|---|---|
| POST | `/connect` | Verify login + return account snapshot |
| POST | `/account` | Refresh equity/balance/open count |
| POST | `/order` | Place market or limit order |
| POST | `/cancel` | Cancel a pending order by id |
| POST | `/positions` | List open positions |
| POST | `/close_all` | Emergency flatten (kill-switch path) |
| POST | `/symbol_spec` | Broker-side symbol spec |
| POST | `/quote` | Current bid/ask tick |

### Single-account (read creds from .env)

Require `MT5_LOGIN`, `MT5_PASSWORD`, `MT5_SERVER` in `.env`.

| Method | Path | Purpose |
|---|---|---|
| GET | `/account` | Equity / balance / open count + watchdog state |
| GET | `/positions` | All open positions for the configured account |
| POST | `/trade/place` | Place order using `{symbol, lot, direction, sl, tp}` shape |
| POST | `/trade/close` | Close ONE open position by ticket |

### Health

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | Public (no auth). Returns mt5_loaded + watchdog state + account + execution_ready |

A "healthy" `/health` in single-account mode reports
`mt5_connected: true`, `execution_ready: true`, a non-null `account`,
and `consec_failures: 0`. If `execution_ready: false`, the watchdog has
seen ≥ `WATCHDOG_MAX_FAILURES` consecutive ping failures — MT5 terminal
likely hung silently.

## Safety guardrails

The signal-engine on Railway has its own 12-gate risk stack (drawdown
limits, kill switch, position sizing). These bridge-side checks are an
*additional* last-line-of-defense in case the engine misbehaves:

- **`MAX_LOT_LIMIT`** (default 100.0): hard ceiling on lot size,
  regardless of broker's `volume_max`.
- **`SYMBOL_WHITELIST`** (default unset): comma-separated list. When
  set, any order on a symbol not in the list is rejected with HTTP 403.
- **`MAX_ORDERS_PER_MIN`** (default 30): rolling 60-second cap on
  order submissions per bridge. Exceeding it returns HTTP 429.

Every order submission and rejection is structured-logged to
`logs/mt5bridge.log` (rotating, 10 MB × 10 files) so you can audit
post-hoc.

## What this bridge does NOT do

- Persist orders or positions itself — the broker is the source of
  truth. The Railway engine reads from `broker_connections` /
  `shadow_executions` for its own state.
- Handle account creation, deposits, KYC — broker-side concerns.
- Implement business logic — the signal engine on Railway decides
  what to trade. This bridge is dumb arms-and-legs.
