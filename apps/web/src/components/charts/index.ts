/**
 * Charts barrel — the components/charts/ surface used elsewhere in the
 * app. The heavy modal stays lazy-loaded inside the provider, so
 * importing from this barrel costs almost nothing (just the provider +
 * the tiny OpenChartButton).
 */
export { default as ChartModalProvider, useChartModal } from './ChartModalProvider'
export { default as OpenChartButton }    from './OpenChartButton'
// Internal — exported for tests / advanced composition; the provider is the
// supported entry point for application code.
export { default as TradingChartModal }  from './TradingChartModal'
export type { ChartTarget } from './ChartModalProvider'
