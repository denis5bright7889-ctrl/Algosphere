/**
 * /styles — public Style Lab (no login).
 *
 * Three visual directions for AlgoSphere Quant, each rendering the SAME
 * sample trading UI so the only variable is the design language. The
 * operator picks one; the winner becomes the global design tokens
 * (globals.css + tailwind), which re-skins the whole app at once.
 *
 * Inline styles are used deliberately here (against the usual Tailwind-only
 * rule) because this is a palette preview — each column must render its own
 * exact colours independent of the app theme.
 */
export const metadata = { title: 'Style Lab — AlgoSphere Quant' }

interface Style {
  id:        'A' | 'B' | 'C'
  name:      string
  vibe:      string
  page:      string   // page background
  panel:     string   // card background
  border:    string
  text:      string
  sub:       string
  accent:    string
  accentText:string
  up:        string
  down:      string
  font:      string
  radius:    number
  glow:      string   // box-shadow for accent button
  panelExtra?: React.CSSProperties
  swatches:  string[]
}

const STYLES: Style[] = [
  {
    id: 'A', name: 'Onyx & Gold', vibe: 'Institutional luxury — warm metallic, calm depth. (Refines today’s look.)',
    page: '#07070a', panel: '#111014', border: '#2a2620', text: '#f5f0e6', sub: '#9a948a',
    accent: '#f5b14c', accentText: '#1a1407', up: '#34d399', down: '#fb7185',
    font: 'ui-sans-serif, system-ui, sans-serif', radius: 14,
    glow: '0 4px 18px rgba(245,177,76,0.35)',
    swatches: ['#07070a', '#111014', '#f5b14c', '#f5f0e6'],
  },
  {
    id: 'B', name: 'Electric Slate', vibe: 'Cool, cinematic, glassy — electric blue on charcoal. Modern fintech.',
    page: '#060911', panel: 'rgba(18,26,43,0.66)', border: '#1e2a44', text: '#eaf0ff', sub: '#8a96b3',
    accent: '#3b82f6', accentText: '#021029', up: '#22d3ee', down: '#f472b6',
    font: 'ui-sans-serif, system-ui, sans-serif', radius: 16,
    glow: '0 6px 22px rgba(59,130,246,0.45)',
    panelExtra: { backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)' },
    swatches: ['#060911', '#3b82f6', '#22d3ee', '#eaf0ff'],
  },
  {
    id: 'C', name: 'Terminal Mono', vibe: 'Bloomberg-dense — high-contrast data, monospace metrics, minimal chrome.',
    page: '#000000', panel: '#0a0a0a', border: '#1c1c1c', text: '#e6e6e6', sub: '#6f6f6f',
    accent: '#f0a500', accentText: '#1a1400', up: '#22c55e', down: '#ef4444',
    font: 'ui-monospace, SFMono-Regular, Menlo, monospace', radius: 4,
    glow: 'none',
    swatches: ['#000000', '#f0a500', '#22c55e', '#e6e6e6'],
  },
]

const SPARK = 'M0,28 L14,22 L28,25 L42,14 L56,18 L70,8 L84,12 L98,4'

function SampleCard({ s }: { s: Style }) {
  return (
    <div style={{
      background: s.panel, border: `1px solid ${s.border}`, borderRadius: s.radius,
      color: s.text, fontFamily: s.font, padding: 18, ...s.panelExtra,
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <span style={{ fontWeight: 800, letterSpacing: '-0.01em', fontSize: 16 }}>BTC/USDT</span>
          <span style={{ color: s.sub, fontSize: 11, textTransform: 'uppercase', letterSpacing: 1 }}>Crypto</span>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums', fontSize: 15 }}>67,420.50</div>
          <div style={{ color: s.up, fontSize: 12, fontWeight: 700 }}>+2.4%</div>
        </div>
      </div>

      {/* Sparkline */}
      <svg viewBox="0 0 98 32" width="100%" height="44" style={{ marginTop: 12, display: 'block' }}>
        <path d={SPARK} fill="none" stroke={s.accent} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      </svg>

      {/* Stat chips */}
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        {[['Regime', 'Trending'], ['Conviction', '78%'], ['Vol', 'Elevated']].map(([k, v]) => (
          <div key={k} style={{
            flex: 1, background: 'rgba(255,255,255,0.04)', border: `1px solid ${s.border}`,
            borderRadius: s.radius - 4 > 0 ? s.radius - 4 : 2, padding: '6px 8px',
          }}>
            <div style={{ color: s.sub, fontSize: 9, textTransform: 'uppercase', letterSpacing: 1 }}>{k}</div>
            <div style={{ fontWeight: 700, fontSize: 13, fontVariantNumeric: 'tabular-nums' }}>{v}</div>
          </div>
        ))}
      </div>

      {/* Signal row */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginTop: 12, padding: '8px 10px', borderRadius: s.radius - 4 > 0 ? s.radius - 4 : 2,
        background: 'rgba(255,255,255,0.03)', border: `1px solid ${s.border}`,
      }}>
        <span style={{ fontSize: 12, color: s.sub }}>entry 67,180 · TP 69,400</span>
        <span style={{
          background: s.up, color: '#04130b', fontWeight: 800, fontSize: 10,
          padding: '2px 8px', borderRadius: 999, textTransform: 'uppercase', letterSpacing: 1,
        }}>Buy</span>
      </div>

      {/* Execute */}
      <button style={{
        width: '100%', marginTop: 12, padding: '10px 0', border: 'none',
        borderRadius: s.radius - 2 > 0 ? s.radius - 2 : 2, cursor: 'pointer',
        background: s.accent, color: s.accentText, fontWeight: 800, fontSize: 13,
        boxShadow: s.glow, letterSpacing: 0.3,
      }}>
        Execute Trade →
      </button>
    </div>
  )
}

export default function StyleLabPage() {
  return (
    <main style={{ minHeight: '100vh', background: '#050507', color: '#f5f5f7', padding: '40px 20px', fontFamily: 'ui-sans-serif, system-ui, sans-serif' }}>
      <div style={{ maxWidth: 1180, margin: '0 auto' }}>
        <header style={{ marginBottom: 28, textAlign: 'center' }}>
          <p style={{ color: '#f5b14c', fontSize: 12, fontWeight: 700, letterSpacing: 3, textTransform: 'uppercase' }}>Style Lab</p>
          <h1 style={{ fontSize: 34, fontWeight: 800, letterSpacing: '-0.02em', margin: '8px 0' }}>
            Pick a visual direction
          </h1>
          <p style={{ color: '#a1a1aa', fontSize: 15, maxWidth: 620, margin: '0 auto' }}>
            Same trading card, three design languages. Tell me <strong style={{ color: '#f5f5f7' }}>A</strong>,{' '}
            <strong style={{ color: '#f5f5f7' }}>B</strong>, or <strong style={{ color: '#f5f5f7' }}>C</strong> —
            the winner becomes the global theme and re-skins the entire app.
          </p>
        </header>

        <div style={{ display: 'grid', gap: 20, gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' }}>
          {STYLES.map((s) => (
            <section key={s.id} style={{ background: s.page, borderRadius: 20, padding: 20, border: '1px solid #1a1a1f' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                <h2 style={{ fontSize: 18, fontWeight: 800, color: s.text }}>
                  <span style={{ color: s.accent }}>{s.id}.</span> {s.name}
                </h2>
                <div style={{ display: 'flex', gap: 5 }}>
                  {s.swatches.map((c) => (
                    <span key={c} style={{ width: 16, height: 16, borderRadius: 4, background: c, border: '1px solid rgba(255,255,255,0.15)' }} />
                  ))}
                </div>
              </div>
              <p style={{ color: s.sub, fontSize: 12, lineHeight: 1.4, marginBottom: 16, minHeight: 34 }}>{s.vibe}</p>
              <SampleCard s={s} />
            </section>
          ))}
        </div>

        <p style={{ color: '#71717a', fontSize: 13, textAlign: 'center', marginTop: 28 }}>
          These are previews — fonts, spacing, glass/contrast, and accent behaviour all change with the choice.
          Want a 4th option or a blend? Say so.
        </p>
      </div>
    </main>
  )
}
