export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const BUILD_FINGERPRINT = 'bootstrap-dock-hq-license-v1'
const ORG_CACHE_TTL_MS = 60 * 1000

type OrgRow = {
  id: string
  name: string
  org_code: string
  email_domain: string | null
  plan: string | null
  max_users: number | null
  license_status?: string | null
  license_renewal_date?: string | null
  grace_period_days?: number | null
  minimum_extension_version?: string | null
}

type ProfileSyncResult = { ok: boolean; phase: string; reason: string; details?: Record<string, unknown> | null }

let serviceSupabaseSingleton: SupabaseClient | null = null
let authSupabaseSingleton: SupabaseClient | null = null
const orgCache = new Map<string, { ts: number; org: OrgRow }>()

function getServiceSupabase() {
  if (serviceSupabaseSingleton) return serviceSupabaseSingleton
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url) throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL')
  if (!serviceRoleKey) throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY')
  serviceSupabaseSingleton = createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } })
  return serviceSupabaseSingleton
}

function getAuthSupabase() {
  if (authSupabaseSingleton) return authSupabaseSingleton
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url) throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL')
  if (!anonKey) throw new Error('Missing NEXT_PUBLIC_SUPABASE_ANON_KEY')
  authSupabaseSingleton = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } })
  return authSupabaseSingleton
}

function normalize(value: unknown): string { return String(value || '').trim() }
function normalizeEmail(value: unknown): string { return normalize(value).toLowerCase() }
function normalizeDomain(value: unknown): string {
  const raw = normalize(value).toLowerCase()
  if (!raw) return ''
  if (raw.includes('@')) return normalize(raw.split('@').pop()).toLowerCase()
  return raw
}

function extractOrgFromDomainRecord(record: any): OrgRow | null {
  const joined = record?.organizations
  if (Array.isArray(joined)) return (joined[0] || null) as OrgRow | null
  return (joined || null) as OrgRow | null
}

function extractOrgFromAllowedUser(record: any): OrgRow | null {
  const joined = record?.organizations
  if (Array.isArray(joined)) return (joined[0] || null) as OrgRow | null
  return (joined || null) as OrgRow | null
}

function buildOrgCacheKey(requestedOrgCode: string, emailDomain: string) {
  return requestedOrgCode ? `org:${requestedOrgCode}` : `domain:${emailDomain}`
}

const ORG_SELECT = 'id, name, org_code, email_domain, plan, max_users, license_status, license_renewal_date, grace_period_days, minimum_extension_version'

async function resolveOrganization(supabase: SupabaseClient, requestedOrgCode: string, emailDomain: string) {
  const normalizedEmailDomain = normalizeDomain(emailDomain)
  const cacheKey = buildOrgCacheKey(requestedOrgCode, normalizedEmailDomain)
  const cached = orgCache.get(cacheKey)
  if (cached && (Date.now() - cached.ts) < ORG_CACHE_TTL_MS) {
    return { data: cached.org, error: null, cacheHit: true, source: requestedOrgCode ? 'org-code' : 'verified-domain', domainRecord: null as any }
  }

  if (requestedOrgCode) {
    const { data, error } = await supabase.from('organizations').select(ORG_SELECT).eq('org_code', requestedOrgCode).maybeSingle()
    if (!error && data) orgCache.set(cacheKey, { ts: Date.now(), org: data as OrgRow })
    return { data: data as OrgRow | null, error, cacheHit: false, source: 'org-code', domainRecord: null as any }
  }

  if (!normalizedEmailDomain) return { data: null, error: null, cacheHit: false, source: 'missing-domain', domainRecord: null as any }

  const { data: domainRecord, error } = await supabase
    .from('organization_domains')
    .select(`organization_id, domain, normalized_domain, status, domain_type, organizations (${ORG_SELECT})`)
    .eq('normalized_domain', normalizedEmailDomain)
    .eq('status', 'verified')
    .maybeSingle()

  if (error) return { data: null, error, cacheHit: false, source: 'verified-domain', domainRecord: null as any }
  const org = extractOrgFromDomainRecord(domainRecord)
  if (org) orgCache.set(cacheKey, { ts: Date.now(), org })
  return { data: org, error: null, cacheHit: false, source: 'verified-domain', domainRecord: domainRecord || null }
}

async function resolveOrganizationByAllowedEmail(supabase: SupabaseClient, userEmail: string) {
  const email = normalizeEmail(userEmail)
  if (!email) return { data: null, error: null, source: 'missing-email', allowedRecord: null as any }
  const { data: allowedRecord, error } = await supabase
    .from('organization_allowed_users')
    .select(`organization_id, email, status, organizations (${ORG_SELECT})`)
    .eq('email', email)
    .eq('status', 'active')
    .maybeSingle()
  if (error) return { data: null, error, source: 'allowed-email', allowedRecord: null as any }
  return { data: extractOrgFromAllowedUser(allowedRecord), error: null, source: 'allowed-email', allowedRecord: allowedRecord || null }
}

function licenseCheck(org: OrgRow) {
  const status = normalize(org.license_status || 'trial').toLowerCase()
  if (status === 'suspended') return { ok: false, code: 'LICENSE_SUSPENDED', message: 'District license is suspended.' }
  if (status === 'expired') return { ok: false, code: 'LICENSE_EXPIRED', message: 'District license is expired.' }
  if (status === 'past_due') {
    const renewal = org.license_renewal_date ? new Date(org.license_renewal_date).getTime() : 0
    const graceDays = Number(org.grace_period_days) || 30
    if (renewal && Date.now() <= renewal + graceDays * 24 * 60 * 60 * 1000) return { ok: true, code: 'GRACE_PERIOD', message: 'District license is in grace period.' }
    return { ok: false, code: 'LICENSE_PAST_DUE', message: 'District license is past due.' }
  }
  return { ok: true, code: status || 'active', message: 'License allows access.' }
}

async function syncProfileIfPossible(supabase: SupabaseClient, userId: string, userEmail: string, org: OrgRow): Promise<ProfileSyncResult> {
  if (!userId || !org?.id) return { ok: false, phase: 'precheck', reason: 'missing-user-or-org', details: { userIdPresent: !!userId, orgIdPresent: !!org?.id } }

  const { data: existing, error: existingError } = await supabase
    .from('profiles')
    .select('id, role, organization_id, email, status')
    .eq('id', userId)
    .maybeSingle()

  if (existingError) return { ok: false, phase: 'select-existing', reason: existingError.message, details: { code: (existingError as any)?.code || null } }

  const sameOrg = normalize(existing?.organization_id) === org.id
  if (!sameOrg) {
    const { count, error: countError } = await supabase
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', org.id)
      .neq('status', 'inactive')
    if (countError) return { ok: false, phase: 'seat-count', reason: countError.message }
    const maxUsers = Number(org.max_users) || 0
    if (maxUsers > 0 && (count || 0) >= maxUsers) {
      return { ok: false, phase: 'seat-limit', reason: 'seat-limit-exceeded', details: { activeSeatCount: count || 0, maxUsers } }
    }
  }

  const normalizedRole = normalize(existing?.role) || 'member'
  const payload = { id: userId, email: normalizeEmail(userEmail) || null, organization_id: org.id, role: normalizedRole, status: 'active' }
  const { data: saved, error: profileError } = await supabase
    .from('profiles')
    .upsert(payload, { onConflict: 'id' })
    .select('id, email, organization_id, role, status')
    .maybeSingle()

  if (profileError) return { ok: false, phase: 'upsert', reason: profileError.message, details: { code: (profileError as any)?.code || null, payload } }
  return { ok: true, phase: existing?.id ? 'updated' : 'inserted', reason: existing?.id ? 'updated' : 'inserted', details: { saved: saved || null } }
}

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url)
    const requestedOrgCode = normalize(url.searchParams.get('orgCode'))
    const requestedDomain = normalizeDomain(url.searchParams.get('domain'))
    const supabase = getServiceSupabase()
    const authSupabase = getAuthSupabase()
    const authHeader = request.headers.get('authorization') || request.headers.get('Authorization') || ''
    const token = authHeader.replace(/^Bearer\s+/i, '').trim()

    let userEmail = ''
    let userId = ''
    let authStatus = 'missing-token'
    if (token) {
      const { data: { user }, error: userError } = await authSupabase.auth.getUser(token)
      if (userError || !user) authStatus = 'invalid-token'
      else { authStatus = 'authenticated'; userId = normalize(user.id); userEmail = normalizeEmail(user.email) }
    }

    const emailDomain = requestedDomain || normalizeDomain(userEmail)
    if (!requestedOrgCode && !emailDomain && !userEmail) return NextResponse.json({ error: 'Missing orgCode, domain, or authenticated email' }, { status: 400 })

    let resolution = await resolveOrganization(supabase, requestedOrgCode, emailDomain)
    let org = resolution.data as OrgRow | null
    let resolutionSource = resolution.source
    let domainRecord = resolution.domainRecord
    let allowedRecord: any = null

    if (!org && userEmail) {
      const allowed = await resolveOrganizationByAllowedEmail(supabase, userEmail)
      if (allowed.error) return NextResponse.json({ error: allowed.error.message }, { status: 500 })
      if (allowed.data) { org = allowed.data; resolutionSource = allowed.source; allowedRecord = allowed.allowedRecord }
    }

    if (resolution.error) return NextResponse.json({ error: resolution.error.message }, { status: 500 })
    if (!org) return NextResponse.json({ error: 'Organization not found', code: 'NO_ORGANIZATION' }, { status: 404 })

    const license = licenseCheck(org)
    if (!license.ok) return NextResponse.json({ error: license.message, code: license.code, orgCode: org.org_code }, { status: 403 })

    let profileSync: ProfileSyncResult
    if (userId) {
      profileSync = await syncProfileIfPossible(supabase, userId, userEmail, org)
      if (!profileSync.ok && profileSync.phase === 'seat-limit') {
        return NextResponse.json({ error: 'Seat limit exceeded for this district.', code: 'SEAT_LIMIT_EXCEEDED', details: profileSync.details }, { status: 403 })
      }
    } else {
      profileSync = { ok: false, phase: 'skipped', reason: authStatus, details: { hasAuthorizationHeader: !!authHeader, tokenPresent: !!token } }
    }

    const origin = url.origin
    const configUrl = `${origin}/api/org/${encodeURIComponent(org.org_code)}/workspace`
    return NextResponse.json({
      organization: { id: org.id, name: org.name, orgCode: org.org_code, emailDomain: org.email_domain || emailDomain },
      organizationName: org.name,
      orgCode: org.org_code,
      emailDomain: org.email_domain || emailDomain,
      configUrl,
      workspacePath: `/api/org/${encodeURIComponent(org.org_code)}/workspace`,
      apiBaseUrl: origin,
      license: org.plan || 'district',
      licenseStatus: org.license_status || 'trial',
      minimumExtensionVersion: org.minimum_extension_version || null,
      syncMode: resolutionSource,
      buildFingerprint: BUILD_FINGERPRINT,
      domainResolution: {
        source: resolutionSource,
        strategy: resolutionSource === 'allowed-email' ? 'outside-domain-allowed-user' : (resolutionSource === 'verified-domain' ? 'verified-domain-registry' : resolutionSource),
        verified: resolutionSource === 'verified-domain' || resolutionSource === 'allowed-email',
        domainRegistryMatched: resolutionSource === 'verified-domain',
        allowedUserMatched: resolutionSource === 'allowed-email',
        domain: domainRecord?.normalized_domain || emailDomain || null,
        allowedEmail: allowedRecord?.email || null,
        organizationId: domainRecord?.organization_id || allowedRecord?.organization_id || org.id
      },
      profileSync: { ok: !!profileSync?.ok, phase: profileSync?.phase || null, reason: profileSync?.reason || null },
      timestamp: new Date().toISOString()
    }, { headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate', 'X-Dock-Build-Fingerprint': BUILD_FINGERPRINT, 'X-Dock-Live-Route': 'true' } })
  } catch (err: any) {
    console.error('BOOTSTRAP fatal error:', err)
    return NextResponse.json({ error: err?.message || 'Unknown error', buildFingerprint: BUILD_FINGERPRINT }, { status: 500 })
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': '*' } })
}
