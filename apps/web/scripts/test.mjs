/**
 * Cross-platform test runner for the TypeScript intelligence suites.
 * Discovers every *.test.ts under src/ and runs them through Node's built-in
 * test runner with type-stripping. Works on Windows + CI (no shell globbing).
 *
 *   node scripts/test.mjs
 *
 * Requires Node >= 22.6 (for --experimental-strip-types + fs.globSync).
 */
import { spawnSync } from 'node:child_process'
import { globSync } from 'node:fs'

const files = globSync('src/**/*.test.ts').sort()
if (files.length === 0) {
  console.error('No *.test.ts files found under src/')
  process.exit(1)
}
console.log(`Running ${files.length} test files…`)

const res = spawnSync(
  process.execPath,
  ['--experimental-strip-types', '--test', ...files],
  { stdio: 'inherit' },
)
process.exit(res.status ?? 1)
