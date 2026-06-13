/** Registers the extensionless/alias TS resolution hook for the test runner. */
import { register } from 'node:module'
register('./ts-loader.mjs', import.meta.url)
