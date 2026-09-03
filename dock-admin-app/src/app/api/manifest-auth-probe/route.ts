import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  const state = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
  const relay = new URL('https://dock-production-mvp.vercel.app/manifest-auth-bridge.html')
  relay.searchParams.set('state', state)
  const auth = new URL('https://mcqohghghfxtchxpaddj.supabase.co/auth/v1/authorize')
  auth.searchParams.set('provider', 'google')
  auth.searchParams.set('redirect_to', relay.toString())
  auth.searchParams.set('scopes', 'https://www.googleapis.com/auth/contacts')

  try {
    const response = await fetch(auth.toString(), { redirect: 'manual', cache: 'no-store' })
    return NextResponse.json({
      ok: true,
      status: response.status,
      location: response.headers.get('location'),
      contentType: response.headers.get('content-type')
    }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return NextResponse.json({ ok: false, error: String(error) }, { status: 500, headers: { 'Cache-Control': 'no-store' } })
  }
}
