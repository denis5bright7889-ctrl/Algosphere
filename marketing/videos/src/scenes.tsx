/**
 * Scene library — one component per (videoId, lineId) tuple.
 *
 * resolveScene() looks up the right scene for the line currently
 * playing. Unmatched lookups fall back to a generic LineCard so the
 * video never crashes mid-render — the line still gets its text on
 * screen, just without the bespoke visual treatment.
 */
import React from 'react'
import { useCurrentFrame, useVideoConfig, interpolate, spring } from 'remotion'

type Scene = React.ReactElement

export function resolveScene(videoId: string, lineId: string, text: string): Scene {
  const key = `${videoId}:${lineId}`
  const fn  = SCENES[key]
  if (fn) return fn(text)
  return <LineCard text={text} />
}


// ─── Reusable atoms ──────────────────────────────────────────────────

const AMBER       = '#fcd34d'
const AMBER_DEEP  = '#f59e0b'
const ROSE        = '#f43f5e'
const EMERALD     = '#34d399'
const SKY         = '#60a5fa'

const fontFamily = 'system-ui,sans-serif'


const LineCard: React.FC<{ text: string }> = ({ text }) => (
  <div style={{
    fontSize: 64, fontWeight: 700, color: 'white',
    lineHeight: 1.18, fontFamily, maxWidth: 900,
  }}>
    {text}
  </div>
)


const BigStat: React.FC<{ value: string; color?: string; label?: string }> = ({ value, color = AMBER, label }) => {
  const frame = useCurrentFrame()
  const pulse = 1 + Math.sin(frame / 9) * 0.04
  return (
    <>
      <div style={{
        fontSize: 280, fontWeight: 900, lineHeight: 1, color,
        textShadow: `0 0 40px ${color}88`,
        fontFamily, transform: `scale(${pulse})`,
      }}>{value}</div>
      {label && (
        <div style={{
          marginTop: 30, fontSize: 50, fontWeight: 700,
          color: 'rgba(255,255,255,0.85)', fontFamily,
        }}>{label}</div>
      )}
    </>
  )
}


const PillRow: React.FC<{ pills: Array<{ label: string; color?: string }> }> = ({ pills }) => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22, width: '100%', maxWidth: 900 }}>
      {pills.map((p, i) => {
        const op = spring({ frame: frame - i * 12, fps, config: { damping: 12, stiffness: 100 } })
        const sy = interpolate(op, [0, 1], [25, 0])
        return (
          <div key={i} style={{
            opacity: op, transform: `translateY(${sy}px)`,
            padding: '24px 32px',
            background: `${p.color ?? AMBER}10`,
            border: `2px solid ${p.color ?? AMBER}55`,
            borderRadius: 24,
            fontSize: 38, fontWeight: 700, color: 'white', fontFamily,
            textAlign: 'left',
          }}>
            {p.label}
          </div>
        )
      })}
    </div>
  )
}


const Headline: React.FC<{ top?: string; main: string; mainColor?: string; sub?: string }> =
  ({ top, main, mainColor = AMBER, sub }) => (
    <>
      {top && (
        <div style={{
          fontSize: 50, fontWeight: 600, color: 'rgba(255,255,255,0.7)',
          fontFamily, marginBottom: 30,
        }}>{top}</div>
      )}
      <div style={{
        fontSize: 96, fontWeight: 900, color: mainColor, lineHeight: 1.05,
        fontFamily, letterSpacing: 1,
        textShadow: `0 0 30px ${mainColor}66`,
      }}>{main}</div>
      {sub && (
        <div style={{
          marginTop: 40, fontSize: 44, color: 'rgba(255,255,255,0.85)',
          fontFamily, fontWeight: 500, maxWidth: 900, lineHeight: 1.25,
        }}>{sub}</div>
      )}
    </>
  )


const CtaCard: React.FC<{ pre?: string; big: string; url?: string }> =
  ({ pre = 'FREE TRIAL', big, url = 'algospherequant.com' }) => {
    const frame = useCurrentFrame()
    const pulse = 1 + Math.sin(frame / 6) * 0.05
    return (
      <>
        <div style={{
          fontSize: 50, fontWeight: 700, color: 'rgba(255,255,255,0.7)',
          fontFamily, marginBottom: 40,
        }}>{pre}</div>
        <div style={{
          fontSize: 70, fontWeight: 900,
          background: `linear-gradient(135deg,${AMBER} 0%,${AMBER_DEEP} 100%)`,
          WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
          fontFamily, lineHeight: 1.1, transform: `scale(${pulse})`,
        }}>{big}</div>
        <div style={{
          marginTop: 30, padding: '24px 50px',
          background: `${AMBER}1f`, border: `3px solid ${AMBER}`, borderRadius: 100,
          fontSize: 38, fontWeight: 700, color: 'white', fontFamily,
          boxShadow: `0 0 40px ${AMBER}55`,
        }}>{url}</div>
        <div style={{
          marginTop: 24, fontSize: 30, fontWeight: 600,
          color: 'rgba(255,255,255,0.6)', fontFamily, letterSpacing: 2,
        }}>LINK IN BIO</div>
      </>
    )
  }


// ════════════════════════════════════════════════════════════════════
// V2 — Why 90% blow accounts
// ════════════════════════════════════════════════════════════════════

const v2Hook = () => (
  <>
    <BigStat value="90%" color={ROSE} />
    <div style={{ fontSize: 60, fontWeight: 800, color: 'white', fontFamily, lineHeight: 1.1, marginTop: 30 }}>
      of traders<br/>blow accounts
    </div>
    <div style={{ marginTop: 40, fontSize: 38, fontWeight: 600, color: AMBER, fontFamily }}>
      It&apos;s not the strategy.
    </div>
  </>
)

const v2Reason = (num: number, headline: string, sub: string) => () => (
  <Headline top={`REASON ${num}`} main={headline} sub={sub} />
)

const v2Fix = () => (
  <>
    <div style={{ fontSize: 50, fontWeight: 700, color: AMBER, fontFamily, letterSpacing: 4, marginBottom: 50 }}>
      ALGOSPHERE FIXES ALL 3
    </div>
    <PillRow pills={[
      { label: '✓ Auto journal',                color: EMERALD },
      { label: '✓ 15-gate risk engine',         color: EMERALD },
      { label: '✓ Market regime detection',     color: EMERALD },
    ]} />
  </>
)

const v2Cta = () => <CtaCard pre="Stop blowing accounts." big="FREE TRIAL" />


// ════════════════════════════════════════════════════════════════════
// V49 — Profit Factor explained
// ════════════════════════════════════════════════════════════════════

const v49Hook = () => (
  <>
    <BigStat value="1.8" color={AMBER} label="PROFIT FACTOR" />
    <div style={{ marginTop: 40, fontSize: 50, fontWeight: 600, color: 'rgba(255,255,255,0.85)', fontFamily }}>
      What does that mean?
    </div>
  </>
)

const v49Def = () => (
  <>
    <div style={{ fontSize: 44, fontWeight: 600, color: 'rgba(255,255,255,0.7)', fontFamily, marginBottom: 30 }}>
      PROFIT FACTOR =
    </div>
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 18,
      padding: '40px 60px', border: `3px solid ${AMBER}55`, borderRadius: 28,
      background: `${AMBER}0d`,
    }}>
      <div style={{ fontSize: 54, fontWeight: 800, color: EMERALD, fontFamily }}>Total Wins</div>
      <div style={{ width: 280, height: 6, background: 'white', borderRadius: 3 }}/>
      <div style={{ fontSize: 54, fontWeight: 800, color: ROSE, fontFamily }}>Total Losses</div>
    </div>
  </>
)

const v49Scale = () => (
  <>
    <div style={{ fontSize: 44, fontWeight: 700, color: AMBER, fontFamily, marginBottom: 40, letterSpacing: 3 }}>
      THE SCALE
    </div>
    <PillRow pills={[
      { label: '1.0  →  breakeven',           color: 'gray' },
      { label: '1.5  →  decent',              color: SKY },
      { label: '2.0+ →  strong',              color: EMERALD },
    ]} />
  </>
)

const v49Rule = () => (
  <Headline
    top="ALGOSPHERE FLAGS"
    main="< 1.3"
    mainColor={ROSE}
    sub="Do not trade it."
  />
)

const v49Good = () => (
  <Headline
    top="GREEN LIGHT"
    main="2.5+ over 100 trades"
    mainColor={EMERALD}
    sub="That's your edge."
  />
)

const v49Cta = () => <CtaCard pre="Test before you risk." big="FREE BACKTESTER" />


// ════════════════════════════════════════════════════════════════════
// V58 — Risk-on vs Risk-off
// ════════════════════════════════════════════════════════════════════

const v58Hook = () => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 40 }}>
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 30 }}>
      <div style={{
        width: 200, height: 200, borderRadius: 30, background: EMERALD,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 80, fontWeight: 900, fontFamily, color: 'black',
        boxShadow: `0 0 50px ${EMERALD}99`,
      }}>ON</div>
      <div style={{ fontSize: 60, fontWeight: 800, color: 'white', fontFamily }}>vs</div>
      <div style={{
        width: 200, height: 200, borderRadius: 30, background: ROSE,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 80, fontWeight: 900, fontFamily, color: 'black',
        boxShadow: `0 0 50px ${ROSE}99`,
      }}>OFF</div>
    </div>
    <div style={{ fontSize: 48, fontWeight: 700, color: 'white', fontFamily, lineHeight: 1.2 }}>
      Controls your<br/>entire trading week
    </div>
  </div>
)

const v58On = () => (
  <>
    <div style={{
      fontSize: 110, fontWeight: 900, color: EMERALD, fontFamily,
      textShadow: `0 0 30px ${EMERALD}88`, marginBottom: 30,
    }}>RISK-ON</div>
    <PillRow pills={[
      { label: '→  Bitcoin · stocks · growth assets', color: EMERALD },
      { label: '→  Money flows INTO risk',           color: EMERALD },
      { label: '→  Trade BUY · take the wave',       color: EMERALD },
    ]} />
  </>
)

const v58Off = () => (
  <>
    <div style={{
      fontSize: 110, fontWeight: 900, color: ROSE, fontFamily,
      textShadow: `0 0 30px ${ROSE}88`, marginBottom: 30,
    }}>RISK-OFF</div>
    <PillRow pills={[
      { label: '→  USD · gold · bonds',           color: ROSE },
      { label: '→  Money flees FROM risk',        color: ROSE },
      { label: '→  Short or step aside',          color: ROSE },
    ]} />
  </>
)

const v58Engine = () => (
  <Headline
    top="ALGOSPHERE REGIME ENGINE"
    main="LIVE READ"
    sub="Per asset. Right now. No guessing."
  />
)

const v58Play = () => (
  <Headline
    top="THE RULE"
    main="Match the regime"
    sub="Or stop fighting it."
  />
)

const v58Cta = () => <CtaCard pre="See today's regime." big="FREE DASHBOARD" />


// ════════════════════════════════════════════════════════════════════
// V69 — Coverage / Reliability / Data Quality / Freshness
// ════════════════════════════════════════════════════════════════════

const v69Hook = () => (
  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, width: '100%', maxWidth: 900 }}>
    <DataTile label="Coverage"     value="92%" tone={EMERALD} />
    <DataTile label="Reliability"  value="HIGH" tone={EMERALD} />
    <DataTile label="Data Quality" value="HIGH" tone={EMERALD} />
    <DataTile label="Freshness"    value="12m"  tone={AMBER} />
  </div>
)

const DataTile: React.FC<{ label: string; value: string; tone: string }> = ({ label, value, tone }) => (
  <div style={{
    padding: '28px 24px',
    background: `${tone}10`,
    border: `2px solid ${tone}55`,
    borderRadius: 24,
    textAlign: 'left',
  }}>
    <div style={{ fontSize: 22, fontWeight: 700, color: 'rgba(255,255,255,0.7)', letterSpacing: 2, fontFamily, marginBottom: 12 }}>
      {label.toUpperCase()}
    </div>
    <div style={{ fontSize: 64, fontWeight: 900, color: tone, fontFamily, lineHeight: 1 }}>
      {value}
    </div>
  </div>
)

const v69Definition = (title: string, def: string, color = AMBER) => () => (
  <>
    <div style={{
      fontSize: 90, fontWeight: 900, color, fontFamily,
      textShadow: `0 0 30px ${color}66`, marginBottom: 36,
      letterSpacing: 1,
    }}>{title}</div>
    <div style={{
      fontSize: 48, fontWeight: 600, color: 'white', fontFamily,
      maxWidth: 900, lineHeight: 1.3,
    }}>{def}</div>
  </>
)

const v69Rule = () => (
  <>
    <div style={{ fontSize: 40, fontWeight: 700, color: 'rgba(255,255,255,0.7)', fontFamily, marginBottom: 30, letterSpacing: 3 }}>
      WHEN TO SIZE DOWN
    </div>
    <PillRow pills={[
      { label: 'Coverage < 60%',          color: ROSE },
      { label: 'Data Quality = LOW',      color: ROSE },
      { label: 'Trade less. Wait.',       color: AMBER },
    ]} />
  </>
)

const v69Cta = () => <CtaCard pre="Institutional discipline." big="ALGOSPHERE QUANT" />


// ════════════════════════════════════════════════════════════════════
// V82 — 15-gate risk system
// ════════════════════════════════════════════════════════════════════

const v82Hook = () => (
  <>
    <BigStat value="15" color={AMBER} label="RISK GATES" />
    <div style={{
      marginTop: 40, fontSize: 48, fontWeight: 700, color: 'white', fontFamily,
      maxWidth: 900, lineHeight: 1.2,
    }}>
      One fails — no trade.
    </div>
  </>
)

const v82Intro = () => (
  <Headline
    top="BEFORE ANY ORDER"
    main="15 GATES"
    sub="Every single trade. Every broker. Every time."
  />
)

const v82List = (nums: string, items: string[]) => () => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  return (
    <>
      <div style={{
        fontSize: 40, fontWeight: 700, color: AMBER, fontFamily,
        letterSpacing: 4, marginBottom: 30,
      }}>GATES {nums}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, width: '100%', maxWidth: 900 }}>
        {items.map((it, i) => {
          const op = spring({ frame: frame - i * 8, fps, config: { damping: 12, stiffness: 110 } })
          const sx = interpolate(op, [0, 1], [-30, 0])
          return (
            <div key={i} style={{
              opacity: op, transform: `translateX(${sx}px)`,
              display: 'flex', alignItems: 'center', gap: 24,
              padding: '20px 28px',
              background: `${EMERALD}10`, border: `2px solid ${EMERALD}55`,
              borderRadius: 20,
              fontSize: 34, fontWeight: 700, color: 'white', fontFamily,
              textAlign: 'left',
            }}>
              <span style={{ color: EMERALD, fontWeight: 900, fontSize: 32 }}>✓</span>
              <span>{it}</span>
            </div>
          )
        })}
      </div>
    </>
  )
}

const v82Rule = () => (
  <Headline
    top="THE CONTRACT"
    main="ALL 15 PASS"
    mainColor={EMERALD}
    sub="Or no order reaches your broker."
  />
)

const v82Cta = () => <CtaCard pre="Institutional risk. Retail simplicity." big="FREE TRIAL" />


// ────────────────────────────────────────────────────────────────────
// Lookup table — videoId:lineId → scene
// ────────────────────────────────────────────────────────────────────

const SCENES: Record<string, (text: string) => Scene> = {
  // V2
  'v2:hook':  v2Hook,
  'v2:r1':    v2Reason(1, 'NO JOURNAL',        "You don't know what's working"),
  'v2:r2':    v2Reason(2, 'NO RISK FIREWALL',  'One revenge trade nukes a week'),
  'v2:r3':    v2Reason(3, 'NO SYSTEM CHECK',   'Trading through bad regimes'),
  'v2:fix':   v2Fix,
  'v2:cta':   v2Cta,

  // V49
  'v49:hook':  v49Hook,
  'v49:def':   v49Def,
  'v49:scale': v49Scale,
  'v49:rule':  v49Rule,
  'v49:good':  v49Good,
  'v49:cta':   v49Cta,

  // V58
  'v58:hook':   v58Hook,
  'v58:on':     v58On,
  'v58:off':    v58Off,
  'v58:engine': v58Engine,
  'v58:play':   v58Play,
  'v58:cta':    v58Cta,

  // V69
  'v69:hook':  v69Hook,
  'v69:cov':   v69Definition('COVERAGE',     '% of engines returning live or degraded data', SKY),
  'v69:rel':   v69Definition('RELIABILITY',  '% at high or medium source quality',           EMERALD),
  'v69:dq':    v69Definition('DATA QUALITY', 'The overall rollup. High / Medium / Low.',     AMBER),
  'v69:fresh': v69Definition('FRESHNESS',    'How recent the newest engine update is',      AMBER_DEEP),
  'v69:rule':  v69Rule,
  'v69:cta':   v69Cta,

  // V82
  'v82:hook':  v82Hook,
  'v82:intro': v82Intro,
  'v82:list1': v82List('1—5',  ['Daily loss cap', 'Weekly loss cap', 'Max consecutive losses', 'Max size increase', 'Drawdown ceiling']),
  'v82:list2': v82List('6—10', ['Correlation cap', 'Spread guard', 'Session window', 'News window block', 'Regime stress']),
  'v82:list3': v82List('11—15',['Kill switch', 'Account tier', 'Broker connection live', 'Position cap per symbol', 'Total exposure cap']),
  'v82:rule':  v82Rule,
  'v82:cta':   v82Cta,
}
