/**
 * Node module-resolution hook for the test runner.
 *
 * Production code uses bundler-style EXTENSIONLESS relative imports
 * (`./drawdown`, `./trust-engine`) and the `@/` path alias. Node's ESM
 * resolver doesn't add those extensions, which previously made any module
 * that VALUE-imported another module non-node-testable (forcing inline
 * mirrors). This hook resolves `./x` → `./x.ts|.tsx|/index.ts` and `@/y` →
 * `src/y(.ts…)`, so tests can import the real modules with no duplication.
 *
 * Used via:  node --experimental-strip-types --import ./scripts/register-ts.mjs
 */
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve as pathResolve, dirname } from 'node:path'

const EXTS = ['.ts', '.tsx', '.js', '.mjs']
const SRC = pathResolve(dirname(fileURLToPath(import.meta.url)), '..', 'src')

function tryExts(absNoExt) {
  if (existsSync(absNoExt) && !absNoExt.endsWith('/')) {
    // exact file exists (already has extension) — let default handle it
  }
  for (const e of EXTS) if (existsSync(absNoExt + e)) return absNoExt + e
  for (const e of EXTS) if (existsSync(pathResolve(absNoExt, 'index' + e))) return pathResolve(absNoExt, 'index' + e)
  return null
}

export async function resolve(specifier, context, nextResolve) {
  const hasExt = /\.[mc]?[jt]sx?$/.test(specifier)

  // `@/x` path alias → <web>/src/x
  if (specifier.startsWith('@/') && !hasExt) {
    const hit = tryExts(pathResolve(SRC, specifier.slice(2)))
    if (hit) return nextResolve(new URL(`file://${hit}`).href, context)
  }

  // Relative extensionless → add a TS/JS extension or /index.
  if (specifier.startsWith('.') && !hasExt && context.parentURL) {
    const baseDir = dirname(fileURLToPath(context.parentURL))
    const hit = tryExts(pathResolve(baseDir, specifier))
    if (hit) return nextResolve(new URL(`file://${hit}`).href, context)
  }

  return nextResolve(specifier, context)
}
