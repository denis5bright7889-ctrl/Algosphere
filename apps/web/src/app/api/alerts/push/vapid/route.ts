import { NextResponse } from 'next/server'

// Returns the VAPID public key so the client can subscribe. Public-safe — only
// the public half is exposed. The private key never leaves the server.
export async function GET() {
  const key = process.env.VAPID_PUBLIC_KEY
  if (!key) {
    return NextResponse.json(
      { error: 'Web Push not configured on server' },
      { status: 503 },
    )
  }
  return NextResponse.json({ publicKey: key })
}
