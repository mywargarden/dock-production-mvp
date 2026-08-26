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
  ownerAuthSupabaseSingleton = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } })
  return ownerAuthSupabaseSingleton
}

export function normalize(value: unknown) { return String(value || '').trim() }
export function normalizeEmail(value: unknown) { return normalize(value).toLowerCase() }
export function normalizeDomain(value: unknown) { return normalize(value).toLowerCase().replace(/^@+/, '') }
export function normalizeThemeSlug(value: unknown) { return normalize(value).toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-+|-+$/g, '') || 'dock-green' }
export function normalizeImageUrl(value: unknown) {
  const raw = normalize(value)
  if (!raw) return ''
  if (raw.startsWith('data:image/')) return raw
  if (/^https?:\/\//i.test(raw)) return raw
  return ''
}

export function ownerEmailSet() {
  const configured = process.env.DOCK_OWNER_EMAILS || process.env.NEXT_PUBLIC_DOCK_OWNER_EMAILS || ''
  const defaults = 'mywargarden@gmail.com,drew.lowery@henry.k12.va.us,southcreeksystems@gmail.com'
  return new Set(`${configured},${defaults}`.split(',').map((email) => normalizeEmail(email)).filter(Boolean))
}

export async function requireOwner(request: NextRequest) {
  const authHeader = request.headers.get('authorization') || request.headers.get('Authorization') || ''
  const token = authHeader.replace(/^Bearer\s+/i, '').trim()
  if (!token) return { error: NextResponse.json({ error: 'Missing bearer token' }, { status: 401 }) }
  const auth = getAuthSupabase()
  const service = getServiceSupabase()
  const { data, error: userError } = await auth.auth.getUser(token)
  const user = data?.user
  if (userError || !user?.id) return { error: NextResponse.json({ error: 'Invalid auth token' }, { status: 401 }) }
  const email = normalizeEmail(user.email)
  if (!ownerEmailSet().has(email)) return { error: NextResponse.json({ error: 'Dock HQ owner access required.' }, { status: 403 }) }
  return { user, service, ownerEmail: email }
}

export type OwnerDistrictPayload = {
  organization: {
    id?: string; name: string; org_code: string; email_domain: string; plan: string; max_users: number
    license_status?: string; license_renewal_date?: string | null; grace_period_days?: number
    minimum_extension_version?: string | null; owner_notes?: string | null
    district_logo_url?: string | null; district_background_url?: string | null; district_accent_color?: string | null
    default_theme?: string | null; allow_user_theme_override?: boolean; allow_admin_branding?: boolean
    customer_contact_name?: string | null; customer_contact_email?: string | null; customer_contact_phone?: string | null
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
  const accent = normalize(organization.district_accent_color || '#8fd8c6')
  return { organization: {
    id: normalize(organization.id) || undefined,
    name, org_code: orgCode, email_domain: primaryDomain,
    plan: normalize(organization.plan) || 'district', max_users: Math.max(1, Number(organization.max_users) || 1),
    license_status: allowedStatuses.has(licenseStatus) ? licenseStatus : 'trial',
    license_renewal_date: normalize(organization.license_renewal_date) || null,
    grace_period_days: Math.max(0, Number(organization.grace_period_days) || 30),
    minimum_extension_version: normalize(organization.minimum_extension_version) || null,
    owner_notes: normalize(organization.owner_notes) || null,
    district_logo_url: normalizeImageUrl(organization.district_logo_url) || null,
    district_background_url: normalizeImageUrl(organization.district_background_url) || null,
    district_accent_color: /^#[0-9a-f]{6}$/i.test(accent) ? accent : '#8fd8c6',
    default_theme: normalizeThemeSlug(organization.default_theme || 'dock-green'),
    allow_user_theme_override: organization.allow_user_theme_override !== false,
    allow_admin_branding: organization.allow_admin_branding !== false,
    customer_contact_name: normalize(organization.customer_contact_name) || null,
    customer_contact_email: normalizeEmail(organization.customer_contact_email) || null,
    customer_contact_phone: normalize(organization.customer_contact_phone) || null
  }, domains: Array.isArray(body?.domains) ? body.domains : [], admins: Array.isArray(body?.admins) ? body.admins : [], allowedUsers: Array.isArray(body?.allowedUsers) ? body.allowedUsers : [] }
}

export function cleanDomains(rawDomains: any[], primaryDomain: string) {
  const map = new Map<string, any>()
  for (const entry of rawDomains || []) { const domain = normalizeDomain(entry?.domain || entry); if (!domain) continue; map.set(domain,{domain,normalized_domain:domain,status:normalize(entry?.status)==='pending'?'pending':'verified',domain_type:normalize(entry?.domain_type)==='primary'?'primary':'additional'}) }
  if (primaryDomain) map.set(primaryDomain,{domain:primaryDomain,normalized_domain:primaryDomain,status:map.get(primaryDomain)?.status||'verified',domain_type:'primary'})
  return Array.from(map.values()).map((entry,index)=>({...entry,domain_type:entry.normalized_domain===primaryDomain||index===0?'primary':'additional'}))
}
export function cleanAdmins(rawAdmins:any[]){const map=new Map<string,any>();for(const entry of rawAdmins||[]){const email=normalizeEmail(entry?.email||entry);if(!email||!email.includes('@'))continue;map.set(email,{email,role:normalize(entry?.role)==='owner'?'owner':'district_admin'})}return Array.from(map.values())}
export function cleanAllowedUsers(rawUsers:any[]){const map=new Map<string,any>();for(const entry of rawUsers||[]){const email=normalizeEmail(entry?.email||entry);if(!email||!email.includes('@'))continue;map.set(email,{email,name:normalize(entry?.name)||null,note:normalize(entry?.note)||null,status:normalize(entry?.status)==='inactive'?'inactive':'active'})}return Array.from(map.values())}

export async function loadOwnerDistricts(service: SupabaseClient) {
  const { data: orgs, error: orgError } = await service.from('organizations').select('*').order('name',{ascending:true})
  if (orgError) throw orgError
  const organizations=orgs||[], orgIds=organizations.map((o:any)=>o.id).filter(Boolean)
  if(!orgIds.length)return []
  const [domainsRes,adminsRes,allowedRes,workspacesRes,profilesRes,versionsRes,auditRes,billingRes,themesRes]=await Promise.all([
    service.from('organization_domains').select('organization_id, domain, normalized_domain, status, domain_type, verified_at').in('organization_id',orgIds).order('normalized_domain',{ascending:true}),
    service.from('organization_admins').select('organization_id, email, role, user_id').in('organization_id',orgIds).order('email',{ascending:true}),
    service.from('organization_allowed_users').select('organization_id, email, name, note, status').in('organization_id',orgIds).order('email',{ascending:true}),
    service.from('workspaces').select('organization_id, id, name, version, published_at, updated_at').in('organization_id',orgIds).eq('status','published').order('published_at',{ascending:false}),
    service.from('profiles').select('organization_id, id, email, role, status, created_at, last_seen_at, updated_at').in('organization_id',orgIds).order('email',{ascending:true}),
    service.from('workspace_versions').select('organization_id, version, name, published_at, created_at').in('organization_id',orgIds).order('version',{ascending:false}).limit(300),
    service.from('audit_logs').select('organization_id, action, target_type, target_id, details, created_at').in('organization_id',orgIds).order('created_at',{ascending:false}).limit(300),
    service.from('billing_subscriptions').select('*').in('organization_id',orgIds),
    service.from('dock_themes').select('id,slug,name,organization_id,scope,status,definition,version,created_at,updated_at,published_at').or(`organization_id.in.(${orgIds.join(',')}),organization_id.is.null`).order('updated_at',{ascending:false})
  ])
  for(const res of [domainsRes,adminsRes,allowedRes,workspacesRes,profilesRes,versionsRes,auditRes,billingRes,themesRes]) if(res.error) throw res.error
  const byOrg=(rows:any[]=[])=>rows.reduce((acc,row)=>{const id=row.organization_id;if(!acc[id])acc[id]=[];acc[id].push(row);return acc},{} as Record<string,any[]>)
  const d=byOrg(domainsRes.data||[]),a=byOrg(adminsRes.data||[]),al=byOrg(allowedRes.data||[]),p=byOrg(profilesRes.data||[]),v=byOrg(versionsRes.data||[]),au=byOrg(auditRes.data||[]),th=byOrg((themesRes.data||[]).filter((t:any)=>t.organization_id))
  const globals=(themesRes.data||[]).filter((t:any)=>!t.organization_id), bill=new Map((billingRes.data||[]).map((r:any)=>[r.organization_id,r])), ws=new Map<string,any>()
  for(const row of workspacesRes.data||[]) if(!ws.has(row.organization_id))ws.set(row.organization_id,row)
  return organizations.map((org:any)=>({organization:org,domains:d[org.id]||[],admins:a[org.id]||[],allowedUsers:al[org.id]||[],users:p[org.id]||[],activeSeatCount:(p[org.id]||[]).filter((x:any)=>x.status!=='inactive').length,publishedWorkspace:ws.get(org.id)||null,workspaceVersions:(v[org.id]||[]).slice(0,18),auditLogs:(au[org.id]||[]).slice(0,24),billing:bill.get(org.id)||null,themes:[...globals,...(th[org.id]||[])]}))
}

export async function persistOwnerDistrict(service: SupabaseClient,payload:OwnerDistrictPayload){
  const nowIso=new Date().toISOString(),o=payload.organization
  const orgPayload:any={name:o.name,org_code:o.org_code,email_domain:o.email_domain,plan:o.plan,max_users:o.max_users,license_status:o.license_status||'trial',license_renewal_date:o.license_renewal_date||null,grace_period_days:o.grace_period_days??30,minimum_extension_version:o.minimum_extension_version||null,owner_notes:o.owner_notes||null,district_logo_url:o.district_logo_url||null,district_background_url:o.district_background_url||null,district_accent_color:o.district_accent_color||'#8fd8c6',default_theme:o.default_theme||'dock-green',allow_user_theme_override:o.allow_user_theme_override!==false,allow_admin_branding:o.allow_admin_branding!==false,customer_contact_name:o.customer_contact_name||null,customer_contact_email:o.customer_contact_email||null,customer_contact_phone:o.customer_contact_phone||null,updated_at:nowIso}
  const {data:orgRow,error:orgError}=await service.from('organizations').upsert(orgPayload,{onConflict:'org_code'}).select('*').single();if(orgError)throw orgError
  const organizationId=orgRow.id,domains=cleanDomains(payload.domains||[],o.email_domain),admins=cleanAdmins(payload.admins||[]),allowed=cleanAllowedUsers(payload.allowedUsers||[])
  await service.from('organization_domains').delete().eq('organization_id',organizationId).throwOnError();if(domains.length)await service.from('organization_domains').upsert(domains.map(e=>({organization_id:organizationId,domain:e.domain,normalized_domain:e.normalized_domain,status:e.status,domain_type:e.domain_type,verified_at:e.status==='verified'?nowIso:null,updated_at:nowIso})),{onConflict:'normalized_domain'}).throwOnError()
  await service.from('organization_admins').delete().eq('organization_id',organizationId).throwOnError();if(admins.length)await service.from('organization_admins').upsert(admins.map(e=>({organization_id:organizationId,email:e.email,role:e.role})),{onConflict:'organization_id,email'}).throwOnError()
  await service.from('organization_allowed_users').delete().eq('organization_id',organizationId).throwOnError();if(allowed.length)await service.from('organization_allowed_users').upsert(allowed.map(e=>({organization_id:organizationId,email:e.email,name:e.name,note:e.note,status:e.status,updated_at:nowIso})),{onConflict:'organization_id,email'}).throwOnError()
  await service.from('audit_logs').insert({organization_id:organizationId,action:'owner_upsert_district',target_type:'organization',target_id:organizationId,details:{orgCode:orgRow.org_code,licenseStatus:orgRow.license_status,maxUsers:orgRow.max_users,defaultTheme:orgRow.default_theme}}).throwOnError()
  return orgRow
}
