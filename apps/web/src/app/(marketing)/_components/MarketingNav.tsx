// HARD ISOLATION TEST — temporarily replaces the real MarketingNav
// with a giant red bar so we can prove from the live site whether
// THIS component is what renders at the top of the marketing page.
// Restore from git (commit before this one) once verified.

export default function MarketingNav() {
  return (
    <div
      data-nav-trace="MarketingNav-ISOLATION"
      style={{
        position:       'fixed',
        top:            0,
        left:           0,
        right:          0,
        height:         '120px',
        background:     'red',
        color:          'white',
        zIndex:         999999,
        fontSize:       '32px',
        fontWeight:     'bold',
        display:        'flex',
        alignItems:     'center',
        justifyContent: 'center',
      }}
    >
      MARKETING NAV DEBUG ACTIVE
    </div>
  )
}
