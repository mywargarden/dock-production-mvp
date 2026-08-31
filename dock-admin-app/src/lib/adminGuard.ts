import { NextRequest, NextResponse } from 'next/server'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { getServiceSupabase } from './adminServer'

let authSupabaseSingleton: SupabaseClient | null = null

function normalize(value: unknown) {
  return String(value || '').trim()
}

function normalizeEmail(value: unknown) {
  return normalize(value).toLowerCase()
}

function getAuthSupabase() {
  if (authSupabaseSingleton) return authSupabaseSingleton
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url) throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL')
  if (!anonKey) throw new Error('Missing NEXT_PUBLIC_SUPABASE_ANON_KEY')
  authSupabaseSingleton = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  })
  return authSupabaseSingleton
}

export async function requireActiveAdmin(request: NextRequest, orgCode?: string) {
  const authHeader = request.headers.get('authorization') || request.headers.get('Authorization') || ''
  const token = authHeader.replace(/^Bearer\s+/i, '').trim()
  if (!token) return { error: NextResponse.json({ error: 'Missing bearer token' }, { status: 401 }) }

  const auth = getAuthSupabase()
  const service = getServiceSupabase()
  const { data, error: userError } = await auth.auth.getUser(token)
  const user = data?.user
  if (userError || !user?.id) return { error: NextResponse.json({ error: 'Invalid auth token' }, { status: 401 }) }

  const userEmail = normalizeEmail(user.email)
  let organizationIdHint = ''

  if (orgCode) {
    const { data: orgRow, error: orgError } = await service
      .from('organizations')
      .select('id,org_code')
      .eq('org_code', orgCode)
      .maybeSingle()
    if (orgError) return { error: NextResponse.json({ error: orgError.message }, { status: 500 }) }
    if (!orgRow?.id) return { error: NextResponse.json({ error: 'Organization not found.' }, { status: 404 }) }
    organizationIdHint = normalize(orgRow.id)
  }

  const { data: profile, error: profileError } = await service
    .from('profiles')
    .select('id,role,organization_id,email,status')
    .eq('id', user.id)
    .maybeSingle()
  if (profileError) return { error: NextResponse.json({ error: profileError.message }, { status: 500 }) }

  const profileOrgId = normalize(profile?.organization_id)
  const profileRole = normalize(profile?.role).toLowerCase()
  const profileStatus = normalize(profile?.status || 'active').toLowerCase()

  if (profile?.id && profileStatus !== 'active') {
    return { error: NextResponse.json({ error: 'Admin account is disabled.', code: 'ACCOUNT_DISABLED' }, { status: 403 }) }
  }

  let grant: any = null
  if (organizationIdHint) {
    const { data: grantRow, error: grantError } = await service
      .from('organization_admins')
      .select('id,organization_id,role,email,status')
      .eq('organization_id', organizationIdHint)
      .eq('email', userEmail)
      .eq('status', 'active')
      .maybeSingle()
    if (grantError) return { error: NextResponse.json({ error: grantError.message }, { status: 500 }) }
    grant = grantRow || null
  } else {
    const { data: grants, error: grantsError } = await service
      .from('organization_admins')
      .select('id,organization_id,role,email,status')
      .eq('email', userEmail)
      .eq('status', 'active')
      .limit(2)
    if (grantsError) return { error: NextResponse.json({ error: grantsError.message }, { status: 500 }) }
    if ((grants || []).length > 1) {
      return { error: NextResponse.json({ error: 'Multiple active district admin grants require an explicit organization.', code: 'AMBIGUOUS_ADMIN_ORGANIZATION' }, { status: 409 }) }
    }
    grant = grants?.[0] || null
  }

  if (!grant?.id) {
    return { error: NextResponse.json({ error: 'Active district admin grant required.', code: 'ADMIN_GRANT_REQUIRED' }, { status: 403 }) }
  }

  const effectiveOrgId = normalize(grant.organization_id)
  if (!effectiveOrgId) return { error: NextResponse.json({ error: 'No district organization is assigned to this admin.' }, { status: 403 }) }

  if (organizationIdHint && effectiveOrgId !== organizationIdHint) {
    return { error: NextResponse.json({ error: 'Admin is not assigned to this organization.', code: 'TENANT_MISMATCH' }, { status: 403 }) }
  }

  if (profile?.id && profileOrgId && profileOrgId !== effectiveOrgId) {
    return { error: NextResponse.json({ error: 'Admin profile is bound to a different organization.', code: 'TENANT_MISMATCH' }, { status: 403 }) }
  }

  if (!profile?.id || profileRole !== 'admin') {
    const { error: syncError } = await service.from('profiles').upsert({
      id: user.id,
      email: userEmail || null,
      organization_id: effectiveOrgId,
      role: 'admin',
      status: 'active'
    }, { onConflict: 'id' })
    if (syncError) return { error: NextResponse.json({ error: syncError.message }, { status: 500 }) }
  }

  return {
    user,
    profile: {
      ...(profile || {}),
      organization_id: effectiveOrgId,
      role: 'admin',
      status: 'active'
    },
    service
  }
}
