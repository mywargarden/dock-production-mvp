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
    district_logo_url?: string | null
    district_background_url?: string | null
    district_accent_color?: string | null
  }
  workspaceName: string
  tabs: CleanAdminTab[]
  domains: OrganizationDomainInput[]
  admins: OrganizationAdminInput[]
}

export type OrganizationDomainInput = {
  domain: string
  status: 'verified' | 'pending'
  domain_type: 'primary' | 'additional'
}

export type OrganizationAdminInput = {
  email: string
  role: 'owner' | 'district_admin'
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

function normalizeDomain(value: unknown) {
  return normalize(value).toLowerCase().replace(/^@+/, '')
}

function normalizeEmail(value: unknown) {
  return normalize(value).toLowerCase()
}

function normalizeImage(value: unknown) {
  const raw = normalize(value)
  if (!raw) return ''
  return raw.startsWith('data:image/') || /^https?:\/\//i.test(raw) ? raw : ''
}

function normalizeUrl(value: unknown) {
  const raw = normalize(value)
  if (!raw) return ''
  return /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
}

function sanitizeDomains(
  rawDomains: any[],
  primaryDomain: string
): OrganizationDomainInput[] {
  const deduped = new Map<string, OrganizationDomainInput>()
  const normalizedPrimary = normalizeDomain(primaryDomain)

  for (const entry of rawDomains) {
    const domain = normalizeDomain(entry?.domain || entry)
    if (!domain) continue
    deduped.set(domain, {
      domain,
      status: normalize(entry?.status) === 'verified' ? 'verified' : 'pending',
      domain_type: normalize(entry?.domain_type) === 'primary' ? 'primary' : 'additional'
    })
  }

  if (normalizedPrimary) {
    deduped.set(normalizedPrimary, {
      domain: normalizedPrimary,
      status: deduped.get(normalizedPrimary)?.status || 'verified',
      domain_type: 'primary'
    })
  }

  const domains = Array.from(deduped.values())
  if (!domains.length && normalizedPrimary) {
    return [{ domain: normalizedPrimary, status: 'verified', domain_type: 'primary' }]
  }

  return domains.map((entry, index) => ({
    ...entry,
    domain_type: index === 0 || entry.domain === normalizedPrimary ? 'primary' : 'additional'
  }))
}

function sanitizeAdmins(rawAdmins: any[]): OrganizationAdminInput[] {
  const deduped = new Map<string, OrganizationAdminInput>()
  for (const entry of rawAdmins) {
    const email = normalizeEmail(entry?.email || entry)
    if (!email || !email.includes('@')) continue
    deduped.set(email, {
      email,
      role: normalize(entry?.role) === 'owner' ? 'owner' : 'district_admin'
    })
  }
  return Array.from(deduped.values())
}

export function validatePayload(body: any): AdminWorkspacePayload {
  const organization = body?.organization || {}
  const workspaceName = normalize(body?.workspaceName)
  const orgCode = normalize(organization.org_code)
  const primaryDomain = normalizeDomain(organization.email_domain)

  if (!orgCode) throw new Error('Organization code is required.')
  if (!workspaceName) throw new Error('Workspace name is required.')

  const tabs = Array.isArray(body?.tabs) ? body.tabs : []
  const cleanTabs = tabs
    .map((tab: any) => ({
      title: normalize(tab?.title),
      url: normalizeUrl(tab?.url),
      icon_url: normalizeImage(tab?.icon_url) || null,
      is_locked: tab?.is_locked !== false
    }))
    .filter((tab: CleanAdminTab) => tab.url)

  if (!cleanTabs.length) throw new Error('Add at least one tab before saving.')

  const domains = sanitizeDomains(
    Array.isArray(body?.domains) ? body.domains : [],
    primaryDomain
  )

  const admins = sanitizeAdmins(Array.isArray(body?.admins) ? body.admins : [])

  return {
    organization: {
      name: normalize(organization.name) || 'District Workspace',
      org_code: orgCode,
      email_domain: primaryDomain,
      plan: normalize(organization.plan) || 'district',
      max_users: Number(organization.max_users) || 500,
      district_logo_url: normalizeImage(organization.district_logo_url) || null,
      district_background_url: normalizeImage(organization.district_background_url) || null,
      district_accent_color: normalize(organization.district_accent_color) || null
    },
    workspaceName,
    tabs: cleanTabs,
    domains,
    admins
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

  const userEmail = normalizeEmail(user.email)
  let organizationIdHint = ''

  if (orgCode) {
    const { data: orgRow, error: orgError } = await service
      .from('organizations')
      .select('id, org_code')
      .eq('org_code', orgCode)
      .maybeSingle()

    if (orgError) {
      return { error: NextResponse.json({ error: orgError.message }, { status: 500 }) }
    }

    organizationIdHint = normalize(orgRow?.id)
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
  const profileOrgId = normalize(profile?.organization_id)

  const { data: adminGrant, error: adminGrantError } = await service
    .from('organization_admins')
    .select('id, organization_id, role, email')
    .eq('email', userEmail)
    .eq(orgCode ? 'organization_id' : 'email', orgCode ? organizationIdHint : userEmail)
    .maybeSingle()

  if (adminGrantError) {
    return { error: NextResponse.json({ error: adminGrantError.message }, { status: 500 }) }
  }

  const hasProfileAdmin = role === 'admin' || role === 'owner'
  const hasGrantAdmin = !!adminGrant?.id
  if (!hasProfileAdmin && !hasGrantAdmin) {
    return { error: NextResponse.json({ error: 'Admin access required for this organization.' }, { status: 403 }) }
  }

  const effectiveOrgId = normalize(adminGrant?.organization_id) || profileOrgId || organizationIdHint

  if (organizationIdHint && effectiveOrgId && effectiveOrgId !== organizationIdHint) {
    return { error: NextResponse.json({ error: 'Profile is not assigned to this organization.' }, { status: 403 }) }
  }

  if (hasGrantAdmin && (!profile?.id || profileOrgId !== effectiveOrgId || !hasProfileAdmin)) {
    const nextRole = normalize(adminGrant?.role) === 'owner' ? 'owner' : 'admin'
    const { error: syncError } = await service.from('profiles').upsert({
      id: user.id,
      email: userEmail || null,
      organization_id: effectiveOrgId || null,
      role: nextRole
    }, { onConflict: 'id' })

    if (syncError) {
      return { error: NextResponse.json({ error: syncError.message }, { status: 500 }) }
    }
  }

  return { user, profile: { ...profile, organization_id: effectiveOrgId || profileOrgId, role: hasProfileAdmin ? role : normalize(adminGrant?.role) || 'admin' }, service }
}

export async function loadOrganizationSettings(service: SupabaseClient, orgCode: string) {
  const { data: orgRow, error: orgError } = await service
    .from('organizations')
    .select('*')
    .eq('org_code', orgCode)
    .maybeSingle()

  if (orgError) throw orgError
  if (!orgRow) return null

  const { data: domains, error: domainError } = await service
    .from('organization_domains')
    .select('id, domain, normalized_domain, status, domain_type, verified_at')
    .eq('organization_id', orgRow.id)
    .order('domain_type', { ascending: true })
    .order('normalized_domain', { ascending: true })

  if (domainError) throw domainError

  const { data: admins, error: adminError } = await service
    .from('organization_admins')
    .select('id, email, role, user_id')
    .eq('organization_id', orgRow.id)
    .order('email', { ascending: true })

  if (adminError) throw adminError

  const { data: publishedWorkspace, error: workspaceError } = await service
    .from('workspaces')
    .select('id, name, version, published_at, updated_at')
    .eq('organization_id', orgRow.id)
    .eq('status', 'published')
    .order('published_at', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (workspaceError) throw workspaceError

  let tabs: any[] = []
  if (publishedWorkspace?.id) {
    const { data: tabRows, error: tabError } = await service
      .from('workspace_tabs')
      .select('title, url, icon_url, is_locked, position')
      .eq('workspace_id', publishedWorkspace.id)
      .order('position', { ascending: true })

    if (tabError) throw tabError
    tabs = tabRows || []
  }

  return {
    organization: orgRow,
    domains: domains || [],
    admins: admins || [],
    publishedWorkspace: publishedWorkspace || null,
    tabs
  }
}

export async function persistOrganizationSettings(
  service: SupabaseClient,
  organizationId: string,
  payload: AdminWorkspacePayload
) {
  const nowIso = new Date().toISOString()
  const domains = payload.domains.length
    ? payload.domains
    : (payload.organization.email_domain
      ? [{ domain: payload.organization.email_domain, status: 'verified', domain_type: 'primary' as const }]
      : [])

  {
    const { error: deleteDomainError } = await service
      .from('organization_domains')
      .delete()
      .eq('organization_id', organizationId)

    if (deleteDomainError) throw deleteDomainError

    if (domains.length) {
    const { error: domainUpsertError } = await service
      .from('organization_domains')
      .upsert(domains.map((entry) => ({
        organization_id: organizationId,
        domain: entry.domain,
        normalized_domain: entry.domain,
        status: entry.status,
        domain_type: entry.domain_type,
        verified_at: entry.status === 'verified' ? nowIso : null,
        updated_at: nowIso
      })), { onConflict: 'normalized_domain' })

    if (domainUpsertError) throw domainUpsertError
    }
  }

  {
    const { error: deleteAdminError } = await service
      .from('organization_admins')
      .delete()
      .eq('organization_id', organizationId)

    if (deleteAdminError) throw deleteAdminError

    if (payload.admins.length) {
    const adminRows = await Promise.all(payload.admins.map(async (entry) => {
      const { data: userRow } = await service
        .from('users')
        .select('id')
        .eq('email', entry.email)
        .maybeSingle()

      return {
        organization_id: organizationId,
        email: entry.email,
        role: entry.role,
        user_id: normalize(userRow?.id) || null
      }
    }))

    const { error: adminUpsertError } = await service
      .from('organization_admins')
      .upsert(adminRows, { onConflict: 'organization_id,email' })

    if (adminUpsertError) throw adminUpsertError
    }
  }
}
