/**
 * WhatsApp Channel adapter (broadcast).
 *
 * WhatsApp Channels (the broadcast surface, distinct from 1:1 Cloud
 * API) DON'T yet have a public posting API as of 2026. The current
 * options for automated broadcast are:
 *   1. WhatsApp Business Cloud API → user-by-user messaging templates
 *      (not the Channel surface).
 *   2. Twilio WhatsApp API → same constraint.
 *   3. Manual paste from a queued draft → admin-driven publish.
 *
 * Until Meta exposes a Channels POST API, this adapter returns a
 * "manual paste" error so the audit log surfaces the constraint
 * honestly. A future option: surface the formatted text in the admin
 * UI as a one-click copy-to-clipboard so the operator can paste it
 * into WhatsApp manually.
 */
import type { AdapterResult } from './telegram'

export async function postToWhatsAppChannel(_text: string): Promise<AdapterResult> {
  return {
    ok:    false,
    error: 'WhatsApp Channels has no public posting API. Use admin manual paste, or wire WhatsApp Business Cloud API for 1:1 templated messages (TWILIO_* env). Not implemented in Phase 2.',
  }
}
