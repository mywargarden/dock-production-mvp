export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const BUILD_FINGERPRINT = 'workspace-dock-hq-v3-dynamic-theme';

function getServerSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL');
  if (!service) throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY');
  return createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
}
function getAuthSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url) throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL');
  if (!anonKey) throw new Error('Missing NEXT_PUBLIC_SUPABASE_ANON_KEY');
  return createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
}
function normalize(value: unknown) { return String(value || '').trim(); }
function toIsoString(value: unknown) { if (!value) return null; const date = new Date(value as string | number | Date); return Number.isNaN(date.getTime()) ? null : date.toISOString(); }
function normalizeManagedUrl(value: unknown) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw)) return raw;
  if (/^[a-z0-9.-]+\.[a-z]{2,}(?:\/.*)?$/i.test(raw)) return `https://${raw}`;
  return '';
}

async function syncProfileFromRequest(request: NextRequest, supabase: ReturnType<typeof getServerSupabase>, org: { id: string }) {
  const authHeader = request.headers.get('authorization') || request.headers.get('Authorization') || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) return { ok: false, phase: 'precheck', reason: 'missing-auth-token' };
  const authSupabase = getAuthSupabase();
  const { data: { user }, error: userError } = await authSupabase.auth.getUser(token);
  if (userError || !user?.id) return { ok: false, phase: 'get-user', reason: userError?.message || 'invalid-user-token' };
  const userId = normalize(user.id);
  const userEmail = normalize(user.email).toLowerCase();
  const { data: existing, error: existingError } = await supabase.from('profiles').select('id, role, organization_id, email,status').eq('id', userId).maybeSingle();
  if (existingError) return { ok: false, phase: 'select-existing', reason: existingError.message };
  if (existing?.status === 'inactive') return { ok: false, phase: 'profile-status', reason: 'USER_INACTIVE' };
  const payload = { id: userId, email: userEmail || null, organization_id: org.id, role: normalize(existing?.role) || 'member', status: existing?.status || 'active', last_seen_at: new Date().toISOString() };
  const { error: profileError } = await supabase.from('profiles').upsert(payload, { onConflict: 'id' });
  if (profileError) return { ok: false, phase: 'upsert', reason: profileError.message };
  return { ok: true, phase: existing?.id ? 'updated' : 'inserted', reason: existing?.id ? 'updated' : 'inserted' };
}

export async function GET(request: NextRequest, { params }: { params: { orgCode: string } }) {
  try {
    const supabase = getServerSupabase();
    const orgCode = decodeURIComponent(params.orgCode || '').trim();
    if (!orgCode) return NextResponse.json({ error: 'Missing org code' }, { status: 400 });

    const { data: org, error: orgError } = await supabase
      .from('organizations')
      .select('id,name,org_code,email_domain,plan,max_users,published_at,license_status,license_renewal_date,grace_period_days,district_logo_url,district_background_url,district_accent_color,minimum_extension_version,default_theme,allow_user_theme_override,allow_admin_branding')
      .eq('org_code', orgCode).maybeSingle();
    if (orgError) return NextResponse.json({ error: orgError.message }, { status: 500 });
    if (!org) return NextResponse.json({ error: 'Organization not found' }, { status: 404 });

    const licenseStatus = String((org as any).license_status || 'trial').trim().toLowerCase();
    if (licenseStatus === 'suspended' || licenseStatus === 'expired') return NextResponse.json({ error: `District license is ${licenseStatus}.`, code: licenseStatus === 'suspended' ? 'LICENSE_SUSPENDED' : 'LICENSE_EXPIRED' }, { status: 403 });
    if (licenseStatus === 'past_due') {
      const renewal = (org as any).license_renewal_date ? new Date((org as any).license_renewal_date).getTime() : 0;
      const graceDays = Number((org as any).grace_period_days) || 30;
      if (!renewal || Date.now() > renewal + graceDays * 86400000) return NextResponse.json({ error: 'District license is past due.', code: 'LICENSE_PAST_DUE' }, { status: 403 });
    }

    const profileSync = await syncProfileFromRequest(request, supabase, org);
    if (profileSync.reason === 'USER_INACTIVE') return NextResponse.json({ error: 'This Dock account is inactive.', code: 'USER_INACTIVE' }, { status: 403 });

    const { data: workspace, error: wsError } = await supabase.from('workspaces').select('id,name,version,published_at,updated_at').eq('organization_id', org.id).eq('status', 'published').order('published_at', { ascending: false }).order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (wsError) return NextResponse.json({ error: wsError.message }, { status: 500 });
    if (!workspace) return NextResponse.json({ error: 'Published workspace not found' }, { status: 404 });

    const { data: tabs, error: tabsError } = await supabase.from('workspace_tabs').select('id,title,url,icon_url,position,created_at,is_locked').eq('workspace_id', workspace.id).order('position', { ascending: true }).order('created_at', { ascending: true });
    if (tabsError) return NextResponse.json({ error: tabsError.message }, { status: 500 });
    const normalizedTabs = (tabs || []).map((tab: any) => ({ title: String(tab?.title || '').trim() || 'Untitled', url: normalizeManagedUrl(tab?.url), customIcon: String(tab?.icon_url || '').trim(), faviconUrl: '', isLocked: tab?.is_locked !== false })).filter((tab) => !!tab.url);

    let dynamicTheme: any = null;
    const themeSlug = String((org as any).default_theme || 'dock-green').trim();
    if (themeSlug) {
      const { data: theme } = await supabase.from('dock_themes').select('id,slug,name,definition,version,status').eq('slug', themeSlug).eq('status', 'published').or(`organization_id.eq.${org.id},organization_id.is.null`).order('organization_id', { ascending: false }).limit(1).maybeSingle();
      if (theme) dynamicTheme = { id: theme.id, slug: theme.slug, name: theme.name, version: theme.version, ...theme.definition };
    }

    const updatedAt = toIsoString(workspace.updated_at) || toIsoString(workspace.published_at) || toIsoString(org.published_at);
    const publishedAt = toIsoString(workspace.published_at) || toIsoString(org.published_at);

    return NextResponse.json({
      version: Number(workspace.version) || 1,
      type: 'dock-managed-config',
      buildFingerprint: BUILD_FINGERPRINT,
      organization: { id: org.id, name: org.name, orgCode: org.org_code, emailDomain: org.email_domain || '' },
      license: { plan: org.plan || 'district', label: (org.plan || 'district').charAt(0).toUpperCase() + (org.plan || 'district').slice(1), maxUsers: org.max_users || 500, status: licenseStatus, minimumExtensionVersion: (org as any).minimum_extension_version || null },
      policies: { allowUserThemeOverride: (org as any).allow_user_theme_override !== false, allowAdminBranding: (org as any).allow_admin_branding !== false },
      workspace: {
        id: workspace.id, name: workspace.name, version: Number(workspace.version) || 1, publishedAt, updatedAt,
        branding: { districtLogoUrl: String((org as any).district_logo_url || '').trim(), districtBackgroundUrl: String((org as any).district_background_url || '').trim(), districtAccentColor: String((org as any).district_accent_color || '').trim(), defaultTheme: themeSlug, dynamicTheme },
        tabs: normalizedTabs
      },
      profileSync: { ok: !!profileSync?.ok, phase: profileSync?.phase || null, reason: profileSync?.reason || null }
    }, { headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': '*', 'X-Dock-Build-Fingerprint': BUILD_FINGERPRINT } });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Unknown server error' }, { status: 500 });
  }
}

export async function OPTIONS() { return new NextResponse(null, { status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': '*' } }); }
