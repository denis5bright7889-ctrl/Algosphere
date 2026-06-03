/**
 * Reusable login helper. Reads DEMO_AUTH_EMAIL + DEMO_AUTH_PASSWORD
 * from env. Returns true on success, false otherwise — never throws.
 * Caller decides whether to skip protected captures.
 *
 * Reuses storageState across runs so we're not hammering Supabase
 * Auth — first run logs in via the form, subsequent runs reuse the
 * cookie jar at .demo-state.json.
 */
import { existsSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { BASE_URL, AUTH } from './config.mjs'

export const STATE_FILE = '.demo-state.json'


/** Whether the credentials are configured. */
export function authConfigured() {
  return Boolean(AUTH.email && AUTH.password)
}


/** Log in via the /login form. The login page exposes
 *  input[type=email] + input[type=password] + a Sign-in button. */
export async function loginViaForm(browser) {
  if (!authConfigured()) return null

  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  try {
    await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle', timeout: 60_000 })
    await page.fill('input[type="email"]',    AUTH.email)
    await page.fill('input[type="password"]', AUTH.password)
    await Promise.all([
      page.waitForURL((u) => !u.toString().includes('/login'), { timeout: 30_000 }),
      page.click('button[type="submit"]'),
    ])
    // Snapshot the storage so subsequent runs skip the form.
    await context.storageState({ path: STATE_FILE })
    return STATE_FILE
  } catch (e) {
    console.error('login failed:', e?.message || e)
    return null
  } finally {
    await page.close()
    await context.close()
  }
}


/** Returns the path to the cached storage state if it exists, else
 *  null. The screenshot/recording scripts use this to skip the
 *  login round-trip for every new browser context. */
export function cachedState() {
  return existsSync(STATE_FILE) ? STATE_FILE : null
}


export async function clearCachedState() {
  try { await writeFile(STATE_FILE, '') } catch {}
}
