'use client'

/** Floating "Save as PDF" control. window.print() + the page's print CSS
 *  turns each slide into one clean PDF page — so the same /deck link is
 *  both a shareable web deck and a downloadable PDF. */
export default function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="fixed bottom-5 right-5 z-50 rounded-full bg-gradient-primary px-4 py-2.5 text-xs font-bold text-black shadow-glow-gold print:hidden"
    >
      ↓ Save as PDF
    </button>
  )
}
