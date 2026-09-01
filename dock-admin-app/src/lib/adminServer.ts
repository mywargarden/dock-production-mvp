import { createClient, type SupabaseClient } from '@supabase/supabase-js'

let serviceSupabaseSingleton: SupabaseClient | null = null

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

function sanitizeDomains(rawDomains: any[], primaryDomain: string): OrganizationDomainInput[] {
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
    domains: sanitizeDomains(Array.isArray(body?.domains) ? body.domains : [], primaryDomain),
    admins: sanitizeAdmins(Array.isArray(body?.admins) ? body.admins : [])
  }
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
