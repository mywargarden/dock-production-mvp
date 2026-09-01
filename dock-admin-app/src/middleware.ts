import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

function jsonError(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status })
}

export async function middleware(request: NextRequest) {
  if (request.method === 'OPTIONS') return NextResponse.next()

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anonKey) return jsonError('Authentication service is unavailable.', 'AUTH_CONFIG_MISSING', 500)

  const authHeader = request.headers.get('authorization') || request.headers.get('Authorization') || ''
  const token = authHeader.replace(/^Bearer\s+/i, '').trim()
  if (!token) return jsonError('Authentication is required.', 'AUTH_REQUIRED', 401)

  const supabase = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  })

  const { data: { user }, error: userError } = await supabase.auth.getUser(token)
  if (userError || !user?.id) return jsonError('Invalid auth token.', 'INVALID_AUTH_TOKEN', 401)

  if (request.nextUrl.pathname === '/api/user/memories') {
    const { data: allowed, error: accessError } = await supabase.rpc('dock_user_access_allowed', {
      p_user_id: user.id,
      p_organization_id: null,
    })
    if (accessError) return jsonError('Could not verify Dock access.', 'ACCESS_CHECK_FAILED', 500)
    if (!allowed) return jsonError('Dock access is disabled or unauthorized.', 'ACCESS_DENIED', 403)
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/api/bootstrap', '/api/user/memories'],
}
