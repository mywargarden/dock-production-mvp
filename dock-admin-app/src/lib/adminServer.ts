import { NextRequest, NextResponse } from 'next/server'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

let serviceSupabaseSingleton: SupabaseClient | null = null
let authSupabaseSingleton: SupabaseClient | null = null

export type CleanAdminTab = {
  title: string
  url: string
  icon_url?: string | null
  is_locked?: boolean
}

export type AdminWorkspacePayload = {
  organization: {
    name: string
    org_code: string
    email_domain: string
    plan: string
    max_users: number
  }
  workspaceName: string
  tabs: CleanAdminTab[]
}

export function getServiceSupabase() {
  if (serviceSupabaseSingleton) return serviceSupabaseSingleton

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url) throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL')
  if (!serviceRoleKey) throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY')

  serviceSupabaseSingleton = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  })

  return serviceSupabaseSingleton
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

function normalize(value: unknown) {
  return String(value || '').trim()
}

function normalizeUrl(value: unknown) {
  const raw = normalize(value)
  if (!raw) return ''
  return /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
}

export function validatePayload(body: any): AdminWorkspacePayload {
  const organization = body?.organization || {}
  const workspaceName = normalize(body?.workspaceName)
  const orgCode = normalize(organization.org_code)

  if (!orgCode) throw new Error('Organization code is required.')
  if (!workspaceName) throw new Error('HCPS Dock name is required.')

  const tabs = Array.isArray(body?.tabs) ? body.tabs : []
  const cleanTabs = tabs
    .map((tab: any) => ({
      title: normalize(tab?.title),
      url: normalizeUrl(tab?.url),
      icon_url: normalize(tab?.icon_url) || null,
      is_locked: tab?.is_locked !== false
    }))
    .filter((tab: CleanAdminTab) => tab.url)

  if (!cleanTabs.length) throw new Error('Add at least one tab before saving.')

  return {
    organization: {
      name: normalize(organization.name) || 'Henry County Public Schools',
      org_code: orgCode,
      email_domain: normalize(organization.email_domain),
      plan: normalize(organization.plan) || 'district',
      max_users: Number(organization.max_users) || 500
    },
    workspaceName,
    tabs: cleanTabs
  }
}

export async function requireAdmin(request: NextRequest, orgCode?: string) {
  const authHeader = request.headers.get('authorization') || request.headers.get('Authorization') || ''
  const token = authHeader.replace(/^Bearer\s+/i, '').trim()

  if (!token) {
    return { error: NextResponse.json({ error: 'Missing bearer token' }, { status: 401 }) }
  }

  const auth = getAuthSupabase()
  const service = getServiceSupabase()

  const { data, error: userError } = await auth.auth.getUser(token)
  const user = data?.user

  if (userError || !user?.id) {
    return { error: NextResponse.json({ error: 'Invalid auth token' }, { status: 401 }) }
  }

  const { data: profile, error: profileError } = await service
    .from('profiles')
    .select('id, role, organization_id, email')
    .eq('id', user.id)
    .maybeSingle()

  if (profileError) {
    return { error: NextResponse.json({ error: profileError.message }, { status: 500 }) }
  }

  const role = normalize(profile?.role).toLowerCase()
  if (role !== 'admin' && role !== 'owner') {
    return { error: NextResponse.json({ error: 'Admin or owner role required.' }, { status: 403 }) }
  }

  if (orgCode && profile?.organization_id) {
    const { data: orgRow, error: orgError } = await service
      .from('organizations')
      .select('id, org_code')
      .eq('org_code', orgCode)
      .maybeSingle()

    if (orgError) {
      return { error: NextResponse.json({ error: orgError.message }, { status: 500 }) }
    }

    if (orgRow?.id && orgRow.id !== profile.organization_id) {
      return { error: NextResponse.json({ error: 'Profile is not assigned to this organization.' }, { status: 403 }) }
    }
  }

  return { user, profile, service }
}
