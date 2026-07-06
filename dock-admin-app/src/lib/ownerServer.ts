import { NextRequest, NextResponse } from 'next/server'
import { type SupabaseClient } from '@supabase/supabase-js'
import { getServiceSupabase } from './adminServer'
import { createClient } from '@supabase/supabase-js'

let ownerAuthSupabaseSingleton: SupabaseClient | null = null

function getAuthSupabase() {
  if (ownerAuthSupabaseSingleton) return ownerAuthSupabaseSingleton
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url) throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL')
  if (!anonKey) throw new Error('Missing NEXT_PUBLIC_SUPABASE_ANON_KEY')
  ownerAuthSupabaseSingleton = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  })
  return ownerAuthSupabaseSingleton
}

export function normalize(value: unknown) {
  return String(value || '').trim()
}

export function normalizeEmail(value: unknown) {
  return normalize(value).toLowerCase()
}

export function normalizeDomain(value: unknown) {
  return normalize(value).toLowerCase().replace(/^@+/, '')
}

export function normalizeUrl(value: unknown) {
  const raw = normalize(value)
  if (!raw) return ''
  return /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
}

export function ownerEmailSet() {
  const configured = process.env.DOCK_OWNER_EMAILS || process.env.NEXT_PUBLIC_DOCK_OWNER_EMAILS || ''
  const defaults = 'mywargarden@gmail.com,drew.lowery@henry.k12.va.us'
  return new Set(`${configured},${defaults}`
    .split(',')
    .map((email) => normalizeEmail(email))
    .filter(Boolean))
}

export async function requireOwner(request: NextRequest) {
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

  const email = normalizeEmail(user.email)
  if (!ownerEmailSet().has(email)) {
    return { error: NextResponse.json({ error: 'Dock HQ owner access required.' }, { status: 403 }) }
  }

  return { user, service, ownerEmail: email }
}

export type OwnerDistrictPayload = {
  organization: {
    id?: string
    name: string
    org_code: string
    email_domain: string
    plan: string
    max_users: number
    license_status?: string
    license_renewal_date?: string | null
    grace_period_days?: number
    minimum_extension_version?: string | null
    owner_notes?: string | null
  }
  domains?: Array<{ domain: string; status?: 'verified' | 'pending'; domain_type?: 'primary' | 'additional' }>
  admins?: Array<{ email: string; role?: 'owner' | 'district_admin' }>
  allowedUsers?: Array<{ email: string; name?: string | null; note?: string | null; status?: 'active' | 'inactive' }>
}

export function validateOwnerDistrictPayload(body: any): OwnerDistrictPayload {
  const organization = body?.organization || {}
  const orgCode = normalize(organization.org_code).toLowerCase().replace(/[^a-z0-9-]/g, '-')
  const primaryDomain = normalizeDomain(organization.email_domain)
  const name = normalize(organization.name)

  if (!name) throw new Error('District name is required.')
  if (!orgCode) throw new Error('Organization code is required.')

  const licenseStatus = normalize(organization.license_status || 'trial').toLowerCase()
  const allowedStatuses = new Set(['trial', 'active', 'past_due', 'suspended', 'expired'])

  return {
    organization: {
      id: normalize(organization.id) || undefined,
      name,
      org_code: orgCode,
      email_domain: primaryDomain,
      plan: normalize(organization.plan) || 'district',
      max_users: Math.max(1, Number(organization.max_users) || 1),
      license_status: allowedStatuses.has(licenseStatus) ? licenseStatus : 'trial',
      license_renewal_date: normalize(organization.license_renewal_date) || null,
      grace_period_days: Math.max(0, Number(organization.grace_period_days) || 30),
      minimum_extension_version: normalize(organization.minimum_extension_version) || null,
      owner_notes: normalize(organization.owner_notes) || null
    },
    domains: Array.isArray(body?.domains) ? body.domains : [],
    admins: Array.isArray(body?.admins) ? body.admins : [],
    allowedUsers: Array.isArray(body?.allowedUsers) ? body.allowedUsers : []
  }
}

export function cleanDomains(rawDomains: any[], primaryDomain: string) {
  const map = new Map<string, any>()
  for (const entry of rawDomains || []) {
    const domain = normalizeDomain(entry?.domain || entry)
    if (!domain) continue
    map.set(domain, {
      domain,
      normalized_domain: domain,
      status: normalize(entry?.status) === 'pending' ? 'pending' : 'verified',
      domain_type: normalize(entry?.domain_type) === 'primary' ? 'primary' : 'additional'
    })
  }
  if (primaryDomain) {
    map.set(primaryDomain, {
      domain: primaryDomain,
      normalized_domain: primaryDomain,
      status: map.get(primaryDomain)?.status || 'verified',
      domain_type: 'primary'
    })
  }
  return Array.from(map.values()).map((entry, index) => ({
    ...entry,
    domain_type: entry.normalized_domain === primaryDomain || index === 0 ? 'primary' : 'additional'
  }))
}

export function cleanAdmins(rawAdmins: any[]) {
  const map = new Map<string, any>()
  for (const entry of rawAdmins || []) {
    const email = normalizeEmail(entry?.email || entry)
    if (!email || !email.includes('@')) continue
    map.set(email, { email, role: normalize(entry?.role) === 'owner' ? 'owner' : 'district_admin' })
  }
  return Array.from(map.values())
}

export function cleanAllowedUsers(rawUsers: any[]) {
  const map = new Map<string, any>()
  for (const entry of rawUsers || []) {
    const email = normalizeEmail(entry?.email || entry)
    if (!email || !email.includes('@')) continue
    map.set(email, {
      email,
      name: normalize(entry?.name) || null,
      note: normalize(entry?.note) || null,
      status: normalize(entry?.status) === 'inactive' ? 'inactive' : 'active'
    })
  }
  return Array.from(map.values())
}

export async function loadOwnerDistricts(service: SupabaseClient) {
  const { data: orgs, error: orgError } = await service
    .from('organizations')
    .select('*')
    .order('name', { ascending: true })

  if (orgError) throw orgError
  const organizations = orgs || []
  const orgIds = organizations.map((org: any) => org.id).filter(Boolean)

  if (!orgIds.length) return []

  const [domainsRes, adminsRes, allowedRes, workspacesRes, profilesRes] = await Promise.all([
    service.from('organization_domains').select('organization_id, domain, normalized_domain, status, domain_type, verified_at').in('organization_id', orgIds).order('normalized_domain', { ascending: true }),
    service.from('organization_admins').select('organization_id, email, role, user_id').in('organization_id', orgIds).order('email', { ascending: true }),
    service.from('organization_allowed_users').select('organization_id, email, name, note, status').in('organization_id', orgIds).order('email', { ascending: true }),
    service.from('workspaces').select('organization_id, name, version, published_at, updated_at').in('organization_id', orgIds).eq('status', 'published').order('published_at', { ascending: false }),
    service.from('profiles').select('organization_id, id, email, status').in('organization_id', orgIds)
  ])

  for (const res of [domainsRes, adminsRes, allowedRes, workspacesRes, profilesRes]) {
    if (res.error) throw res.error
  }

  const byOrg = (rows: any[] = []) => rows.reduce((acc, row) => {
    const id = row.organization_id
    if (!acc[id]) acc[id] = []
    acc[id].push(row)
    return acc
  }, {} as Record<string, any[]>)

  const domainsByOrg = byOrg(domainsRes.data || [])
  const adminsByOrg = byOrg(adminsRes.data || [])
  const allowedByOrg = byOrg(allowedRes.data || [])
  const profilesByOrg = byOrg(profilesRes.data || [])
  const workspaceByOrg = new Map<string, any>()
  for (const ws of workspacesRes.data || []) {
    if (!workspaceByOrg.has(ws.organization_id)) workspaceByOrg.set(ws.organization_id, ws)
  }

  return organizations.map((org: any) => ({
    organization: org,
    domains: domainsByOrg[org.id] || [],
    admins: adminsByOrg[org.id] || [],
    allowedUsers: allowedByOrg[org.id] || [],
    activeSeatCount: (profilesByOrg[org.id] || []).filter((p: any) => p.status !== 'inactive').length,
    publishedWorkspace: workspaceByOrg.get(org.id) || null
  }))
}

export async function persistOwnerDistrict(service: SupabaseClient, payload: OwnerDistrictPayload) {
  const nowIso = new Date().toISOString()
  const orgPayload: any = {
    name: payload.organization.name,
    org_code: payload.organization.org_code,
    email_domain: payload.organization.email_domain,
    plan: payload.organization.plan,
    max_users: payload.organization.max_users,
    license_status: payload.organization.license_status || 'trial',
    license_renewal_date: payload.organization.license_renewal_date || null,
    grace_period_days: payload.organization.grace_period_days || 30,
    minimum_extension_version: payload.organization.minimum_extension_version || null,
    owner_notes: payload.organization.owner_notes || null,
    updated_at: nowIso
  }

  const { data: orgRow, error: orgError } = await service
    .from('organizations')
    .upsert(orgPayload, { onConflict: 'org_code' })
    .select('*')
    .single()

  if (orgError) throw orgError

  const organizationId = orgRow.id
  const domains = cleanDomains(payload.domains || [], payload.organization.email_domain)
  const admins = cleanAdmins(payload.admins || [])
  const allowedUsers = cleanAllowedUsers(payload.allowedUsers || [])

  await service.from('organization_domains').delete().eq('organization_id', organizationId).throwOnError()
  if (domains.length) {
    await service.from('organization_domains').upsert(domains.map((entry) => ({
      organization_id: organizationId,
      domain: entry.domain,
      normalized_domain: entry.normalized_domain,
      status: entry.status,
      domain_type: entry.domain_type,
      verified_at: entry.status === 'verified' ? nowIso : null,
      updated_at: nowIso
    })), { onConflict: 'normalized_domain' }).throwOnError()
  }

  await service.from('organization_admins').delete().eq('organization_id', organizationId).throwOnError()
  if (admins.length) {
    await service.from('organization_admins').upsert(admins.map((entry) => ({
      organization_id: organizationId,
      email: entry.email,
      role: entry.role
    })), { onConflict: 'organization_id,email' }).throwOnError()
  }

  await service.from('organization_allowed_users').delete().eq('organization_id', organizationId).throwOnError()
  if (allowedUsers.length) {
    await service.from('organization_allowed_users').upsert(allowedUsers.map((entry) => ({
      organization_id: organizationId,
      email: entry.email,
      name: entry.name,
      note: entry.note,
      status: entry.status,
      updated_at: nowIso
    })), { onConflict: 'organization_id,email' }).throwOnError()
  }

  await service.from('audit_logs').insert({
    organization_id: organizationId,
    action: 'owner_upsert_district',
    target_type: 'organization',
    target_id: organizationId,
    details: { orgCode: orgRow.org_code, licenseStatus: orgRow.license_status, maxUsers: orgRow.max_users }
  }).throwOnError()

  return orgRow
}
