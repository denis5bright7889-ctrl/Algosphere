'use client'

/**
 * Per-section error boundary for the workspace shell.
 *
 * Wraps each child (tabs, sidebar, grid, AI rail). A throw in one
 * section now degrades to a small inline error pill in that section,
 * instead of crashing the entire /workspace route into the dashboard
 * error boundary. The boundary also surfaces the actual error message
 * + the section name so the operator can identify which subsystem
 * failed without having to decode minified stack frames.
 *
 * React 19+ error boundaries still require a class component — there
 * is no hook equivalent for componentDidCatch / getDerivedStateFromError.
 */
import { Component, type ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'

interface Props {
  section:  string
  children: ReactNode
}

interface State {
  error: Error | null
}

export default class SectionBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error): void {
    // Surface to the browser console so the operator can copy the
    // full stack from devtools even when the inline UI is minimal.
    console.error(`[workspace:${this.props.section}] caught:`, error)
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="flex h-full min-h-[60px] w-full items-start gap-2 rounded-lg border border-rose-500/30 bg-rose-500/5 p-3 text-[11px] text-rose-200/90">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-bold uppercase tracking-widest text-rose-300">
              {this.props.section} failed
            </p>
            <p className="mt-0.5 break-words font-mono text-[10px]">
              {this.state.error.message || 'Unknown error'}
            </p>
            <button
              type="button"
              onClick={() => this.setState({ error: null })}
              className="mt-1.5 rounded border border-rose-500/40 px-2 py-0.5 text-[10px] font-semibold hover:bg-rose-500/10"
            >
              Retry
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
