import { NextRequest, NextResponse } from 'next/server'
import { type SupabaseClient, createClient } from '@supabase/supabase-js'
import { getServiceSupabase } from './adminServer'

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
function color(value: unknown, fallback: string) { const v=normalize(value); return /^#[0-9a-f]{6}$/i.test(v)?v:fallback }

export function ownerEmailSet() {
  const configured = process.env.DOCK_OWNER_EMAILS || process.env.NEXT_PUBLIC_DOCK_OWNER_EMAILS || ''
  const defaults = 'mywargarden@gmail.com,drew.lowery@henry.k12.va.us,southcreeksystems@gmail.com'
  return new Set(`${configured},${defaults}`.split(',').map(normalizeEmail).filter(Boolean))
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
  organization: any
  domains?: any[]
  admins?: any[]
  allowedUsers?: any[]
}

export function validateOwnerDistrictPayload(body: any): OwnerDistrictPayload {
  const organization = body?.organization || {}
  const orgCode = normalize(organization.org_code).toLowerCase().replace(/[^a-z0-9-]/g, '-')
  const primaryDomain = normalizeDomain(organization.email_domain)
  const name = normalize(organization.name)
  if (!name) throw new Error('District name is required.')
  if (!orgCode) throw new Error('Organization code is required.')
  const licenseStatus = normalize(organization.license_status || 'trial').toLowerCase()
  const lifecycle = normalize(organization.customer_lifecycle || 'setup').toLowerCase()
  const cadence = normalize(organization.billing_cadence || 'annual').toLowerCase()
  const allowedStatuses = new Set(['trial','active','past_due','suspended','expired'])
  const allowedLifecycle = new Set(['lead','setup','trial','active','offboarding','archived'])
  const allowedCadence = new Set(['monthly','annual','custom'])
  return { organization: {
    id: normalize(organization.id) || undefined,
    name, org_code: orgCode, email_domain: primaryDomain,
    plan: normalize(organization.plan) || 'district',
    max_users: Math.max(1, Number(organization.max_users) || 1),
    license_status: allowedStatuses.has(licenseStatus) ? licenseStatus : 'trial',
    license_renewal_date: normalize(organization.license_renewal_date) || null,
    grace_period_days: Math.max(0, Number(organization.grace_period_days) || 30),
    minimum_extension_version: normalize(organization.minimum_extension_version) || null,
    owner_notes: normalize(organization.owner_notes) || null,
    district_logo_url: normalizeImageUrl(organization.district_logo_url) || null,
    district_background_url: normalizeImageUrl(organization.district_background_url) || null,
    district_accent_color: color(organization.district_accent_color,'#8fd8c6'),
    district_primary_color: color(organization.district_primary_color, color(organization.district_accent_color,'#2b8c8f')),
    district_secondary_color: color(organization.district_secondary_color,'#75a7c8'),
    default_theme: normalizeThemeSlug(organization.default_theme || 'dock-green'),
    allow_user_theme_override: organization.allow_user_theme_override !== false,
    allow_admin_branding: organization.allow_admin_branding !== false,
    branding_permissions: typeof organization.branding_permissions==='object' && organization.branding_permissions ? organization.branding_permissions : {logo:true,colors:true,background:true,theme:true},
    customer_contact_name: normalize(organization.customer_contact_name) || null,
    customer_contact_email: normalizeEmail(organization.customer_contact_email) || null,
    customer_contact_phone: normalize(organization.customer_contact_phone) || null,
    technical_contact_name: normalize(organization.technical_contact_name) || null,
    technical_contact_email: normalizeEmail(organization.technical_contact_email) || null,
    technical_contact_phone: normalize(organization.technical_contact_phone) || null,
    billing_contact_name: normalize(organization.billing_contact_name) || null,
    billing_contact_email: normalizeEmail(organization.billing_contact_email) || null,
    billing_contact_phone: normalize(organization.billing_contact_phone) || null,
    customer_lifecycle: allowedLifecycle.has(lifecycle) ? lifecycle : 'setup',
    trial_start_date: normalize(organization.trial_start_date) || null,
    trial_end_date: normalize(organization.trial_end_date) || null,
    billing_price_cents: organization.billing_price_cents==='' || organization.billing_price_cents==null ? null : Math.max(0, Number(organization.billing_price_cents)||0),
    billing_cadence: allowedCadence.has(cadence) ? cadence : 'annual'
  }, domains: Array.isArray(body?.domains)?body.domains:[], admins:Array.isArray(body?.admins)?body.admins:[], allowedUsers:Array.isArray(body?.allowedUsers)?body.allowedUsers:[] }
}

export function cleanDomains(rawDomains:any[],primaryDomain:string){
  const map=new Map<string,any>()
  for(const entry of rawDomains||[]){const domain=normalizeDomain(entry?.domain||entry);if(!domain)continue;map.set(domain,{domain,normalized_domain:domain,status:normalize(entry?.status)==='pending'?'pending':'verified',domain_type:normalize(entry?.domain_type)==='primary'?'primary':'additional'})}
  if(primaryDomain)map.set(primaryDomain,{domain:primaryDomain,normalized_domain:primaryDomain,status:map.get(primaryDomain)?.status||'verified',domain_type:'primary'})
  return Array.from(map.values()).map((entry,index)=>({...entry,domain_type:entry.normalized_domain===primaryDomain||index===0?'primary':'additional'}))
}
export function cleanAdmins(raw:any[]){const map=new Map<string,any>();for(const x of raw||[]){const email=normalizeEmail(x?.email||x);if(!email||!email.includes('@'))continue;map.set(email,{email,name:normalize(x?.name)||null,role:normalize(x?.role)==='owner'?'owner':'district_admin',status:normalize(x?.status)==='disabled'?'disabled':'active'})}return Array.from(map.values())}
export function cleanAllowedUsers(raw:any[]){const map=new Map<string,any>();for(const x of raw||[]){const email=normalizeEmail(x?.email||x);if(!email||!email.includes('@'))continue;map.set(email,{email,name:normalize(x?.name)||null,note:normalize(x?.note)||null,status:normalize(x?.status)==='inactive'?'inactive':'active',expires_at:normalize(x?.expires_at)||null})}return Array.from(map.values())}

export async function loadOwnerDistricts(service:SupabaseClient){
  const {data:orgs,error:orgError}=await service.from('organizations').select('*').order('name',{ascending:true});if(orgError)throw orgError
  const organizations=orgs||[],orgIds=organizations.map((o:any)=>o.id).filter(Boolean);if(!orgIds.length)return []
  const [domainsRes,adminsRes,allowedRes,workspacesRes,profilesRes,versionsRes,auditRes,billingRes,themesRes,tabsRes,installRes]=await Promise.all([
    service.from('organization_domains').select('organization_id,domain,normalized_domain,status,domain_type,verified_at').in('organization_id',orgIds).order('normalized_domain',{ascending:true}),
    service.from('organization_admins').select('organization_id,email,name,role,status,user_id,created_at,updated_at').in('organization_id',orgIds).order('email',{ascending:true}),
    service.from('organization_allowed_users').select('organization_id,email,name,note,status,expires_at,created_at,updated_at').in('organization_id',orgIds).order('email',{ascending:true}),
    service.from('workspaces').select('organization_id,id,name,version,published_at,updated_at').in('organization_id',orgIds).eq('status','published').order('published_at',{ascending:false}),
    service.from('profiles').select('organization_id,id,email,role,status,created_at,last_seen_at,updated_at').in('organization_id',orgIds).order('email',{ascending:true}),
    service.from('workspace_versions').select('organization_id,workspace_id,version,name,published_at,created_at,tabs,branding').in('organization_id',orgIds).order('version',{ascending:false}).limit(500),
    service.from('audit_logs').select('organization_id,actor_email,action,target_type,target_id,details,metadata,created_at').in('organization_id',orgIds).order('created_at',{ascending:false}).limit(500),
    service.from('billing_subscriptions').select('*').in('organization_id',orgIds),
    service.from('dock_themes').select('id,slug,name,organization_id,scope,status,definition,version,created_at,updated_at,published_at').or(`organization_id.in.(${orgIds.join(',')}),organization_id.is.null`).order('updated_at',{ascending:false}),
    service.from('workspace_tabs').select('workspace_id,id,title,url,icon_url,position,is_locked').order('position',{ascending:true}),
    service.from('extension_installations').select('organization_id,email,extension_version,last_seen_at').in('organization_id',orgIds).order('last_seen_at',{ascending:false})
  ])
  for(const res of [domainsRes,adminsRes,allowedRes,workspacesRes,profilesRes,versionsRes,auditRes,billingRes,themesRes,tabsRes,installRes])if(res.error)throw res.error
  const byOrg=(rows:any[]=[])=>rows.reduce((acc,row)=>{const id=row.organization_id;if(!acc[id])acc[id]=[];acc[id].push(row);return acc},{} as Record<string,any[]>)
  const d=byOrg(domainsRes.data||[]),a=byOrg(adminsRes.data||[]),al=byOrg(allowedRes.data||[]),p=byOrg(profilesRes.data||[]),v=byOrg(versionsRes.data||[]),au=byOrg(auditRes.data||[]),th=byOrg((themesRes.data||[]).filter((t:any)=>t.organization_id)),ins=byOrg(installRes.data||[])
  const globals=(themesRes.data||[]).filter((t:any)=>!t.organization_id),bill=new Map((billingRes.data||[]).map((r:any)=>[r.organization_id,r])),ws=new Map<string,any>(),workspaceToOrg=new Map<string,string>()
  for(const row of workspacesRes.data||[]){workspaceToOrg.set(row.id,row.organization_id);if(!ws.has(row.organization_id))ws.set(row.organization_id,row)}
  const tabsByOrg:Record<string,any[]>={};for(const tab of tabsRes.data||[]){const oid=workspaceToOrg.get(tab.workspace_id);if(!oid)continue;(tabsByOrg[oid]||=[]).push(tab)}
  return organizations.map((org:any)=>{const users=p[org.id]||[];return {organization:org,domains:d[org.id]||[],admins:a[org.id]||[],allowedUsers:al[org.id]||[],users,activeSeatCount:users.filter((x:any)=>x.status==='active').length,publishedWorkspace:ws.get(org.id)||null,workspaceTabs:tabsByOrg[org.id]||[],workspaceVersions:(v[org.id]||[]).slice(0,30),auditLogs:(au[org.id]||[]).slice(0,50),billing:bill.get(org.id)||null,themes:[...globals,...(th[org.id]||[])],installations:ins[org.id]||[]}}
  )
}

export async function persistOwnerDistrict(service:SupabaseClient,payload:OwnerDistrictPayload){
  const nowIso=new Date().toISOString(),o=payload.organization
  const orgPayload:any={...o,updated_at:nowIso}
  delete orgPayload.id
  const {data:existing}=await service.from('organizations').select('id,org_code').eq('id',o.id||'00000000-0000-0000-0000-000000000000').maybeSingle()
  if(existing&&existing.org_code!==o.org_code)throw new Error('Organization code is locked after creation. Contact support workflow to migrate an org code safely.')
  const {data:orgRow,error:orgError}=await service.from('organizations').upsert(orgPayload,{onConflict:'org_code'}).select('*').single();if(orgError)throw orgError
  const organizationId=orgRow.id,domains=cleanDomains(payload.domains||[],o.email_domain),admins=cleanAdmins(payload.admins||[]),allowed=cleanAllowedUsers(payload.allowedUsers||[])
  await service.from('organization_domains').delete().eq('organization_id',organizationId).throwOnError();if(domains.length)await service.from('organization_domains').upsert(domains.map(e=>({organization_id:organizationId,...e,verified_at:e.status==='verified'?nowIso:null,updated_at:nowIso})),{onConflict:'normalized_domain'}).throwOnError()
  await service.from('organization_admins').delete().eq('organization_id',organizationId).throwOnError();if(admins.length)await service.from('organization_admins').upsert(admins.map(e=>({organization_id:organizationId,...e,updated_at:nowIso})),{onConflict:'organization_id,email'}).throwOnError()
  await service.from('organization_allowed_users').delete().eq('organization_id',organizationId).throwOnError();if(allowed.length)await service.from('organization_allowed_users').upsert(allowed.map(e=>({organization_id:organizationId,...e,updated_at:nowIso})),{onConflict:'organization_id,email'}).throwOnError()
  await service.from('audit_logs').insert({organization_id:organizationId,action:'owner_upsert_district',actor_email:null,target_type:'organization',target_id:organizationId,details:{orgCode:orgRow.org_code,licenseStatus:orgRow.license_status,maxUsers:orgRow.max_users,defaultTheme:orgRow.default_theme,lifecycle:orgRow.customer_lifecycle}}).throwOnError()
  return orgRow
}
