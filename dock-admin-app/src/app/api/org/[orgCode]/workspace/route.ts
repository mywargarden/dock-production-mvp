export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const BUILD_FINGERPRINT = 'workspace-dock-hq-branding-v3-current-access';

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

function normalize(value: unknown) {
  return String(value || '').trim();
}

function toIsoString(value: unknown) {
  if (!value) return null;
  const date = new Date(value as string | number | Date);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function normalizeManagedUrl(value: unknown) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw)) return raw;
  if (/^[a-z0-9.-]+\.[a-z]{2,}(?:\/.*)?$/i.test(raw)) return `https://${raw}`;
  return '';
}

async function requireActiveUserForOrganization(
  request: NextRequest,
  supabase: ReturnType<typeof getServerSupabase>,
  org: { id: string }
) {
  const authHeader = request.headers.get('authorization') || request.headers.get('Authorization') || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) return { error: NextResponse.json({ error: 'Missing bearer token', code: 'AUTH_REQUIRED' }, { status: 401 }) };

  const authSupabase = getAuthSupabase();
  const { data: { user }, error: userError } = await authSupabase.auth.getUser(token);
  if (userError || !user?.id) {
    return { error: NextResponse.json({ error: 'Invalid auth token', code: 'INVALID_AUTH_TOKEN' }, { status: 401 }) };
  }

  const userId = normalize(user.id);
  const userEmail = normalize(user.email).toLowerCase();

  const { data: existing, error: existingError } = await supabase
    .from('profiles')
    .select('id, role, organization_id, email, status')
    .eq('id', userId)
    .maybeSingle();

  if (existingError) {
    return { error: NextResponse.json({ error: existingError.message, code: 'PROFILE_LOOKUP_FAILED' }, { status: 500 }) };
  }

  if (!existing?.id) {
    return { error: NextResponse.json({ error: 'User is not provisioned for this district.', code: 'PROFILE_REQUIRED' }, { status: 403 }) };
  }

  if (normalize(existing.status || 'active').toLowerCase() !== 'active') {
    return { error: NextResponse.json({ error: 'User account is disabled.', code: 'ACCOUNT_DISABLED' }, { status: 403 }) };
  }

  if (normalize(existing.organization_id) !== normalize(org.id)) {
    return { error: NextResponse.json({ error: 'User is not authorized for this district.', code: 'TENANT_MISMATCH' }, { status: 403 }) };
  }

  const { data: allowed, error: accessError } = await supabase.rpc('dock_user_access_allowed', {
    p_user_id: userId,
    p_organization_id: org.id,
  });
  if (accessError) {
    return { error: NextResponse.json({ error: accessError.message, code: 'ACCESS_CHECK_FAILED' }, { status: 500 }) };
  }
  if (!allowed) {
    return { error: NextResponse.json({ error: 'Dock access is disabled or unauthorized.', code: 'ACCESS_DENIED' }, { status: 403 }) };
  }

  if (userEmail && normalize(existing.email).toLowerCase() !== userEmail) {
    const { error: emailUpdateError } = await supabase
      .from('profiles')
      .update({ email: userEmail, updated_at: new Date().toISOString() })
      .eq('id', userId)
      .eq('organization_id', org.id);
    if (emailUpdateError) {
      return { error: NextResponse.json({ error: emailUpdateError.message, code: 'PROFILE_EMAIL_SYNC_FAILED' }, { status: 403 }) };
    }
  }

  return { user: { id: userId, email: userEmail, role: normalize(existing.role) || 'member' } };
}

export async function GET(request: NextRequest, { params }: { params: { orgCode: string } }) {
  try {
    const supabase = getServerSupabase();
    const orgCode = decodeURIComponent(params.orgCode || '').trim();
    if (!orgCode) return NextResponse.json({ error: 'Missing org code' }, { status: 400 });

    const { data: org, error: orgError } = await supabase
      .from('organizations')
      .select('id,name,org_code,email_domain,plan,max_users,published_at,license_status,license_renewal_date,grace_period_days,customer_lifecycle,district_logo_url,district_background_url,district_accent_color,minimum_extension_version')
      .eq('org_code', orgCode)
      .maybeSingle();
    if (orgError) return NextResponse.json({ error: orgError.message }, { status: 500 });
    if (!org) return NextResponse.json({ error: 'Organization not found' }, { status: 404 });

    const auth = await requireActiveUserForOrganization(request, supabase, org);
    if ('error' in auth) return auth.error;

    const licenseStatus = String((org as any).license_status || 'trial').trim().toLowerCase();
    if (licenseStatus === 'suspended' || licenseStatus === 'expired') {
      return NextResponse.json({ error: `District license is ${licenseStatus}.`, code: licenseStatus === 'suspended' ? 'LICENSE_SUSPENDED' : 'LICENSE_EXPIRED' }, { status: 403 });
    }
    if (licenseStatus === 'past_due') {
      const renewal = (org as any).license_renewal_date ? new Date((org as any).license_renewal_date).getTime() : 0;
      const graceDays = Number((org as any).grace_period_days) || 30;
      if (!renewal || Date.now() > renewal + graceDays * 24 * 60 * 60 * 1000) {
        return NextResponse.json({ error: 'District license is past due.', code: 'LICENSE_PAST_DUE' }, { status: 403 });
      }
    }

    const { data: workspace, error: wsError } = await supabase
      .from('workspaces')
      .select('id,name,version,published_at,updated_at')
      .eq('organization_id', org.id)
      .eq('status', 'published')
      .order('published_at', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (wsError) return NextResponse.json({ error: wsError.message }, { status: 500 });
    if (!workspace) return NextResponse.json({ error: 'Published workspace not found' }, { status: 404 });

    const { data: tabs, error: tabsError } = await supabase
      .from('workspace_tabs')
      .select('id, title, url, icon_url, position, created_at, is_locked')
      .eq('workspace_id', workspace.id)
      .order('position', { ascending: true })
      .order('created_at', { ascending: true });
    if (tabsError) return NextResponse.json({ error: tabsError.message }, { status: 500 });

    const normalizedTabs = (tabs || [])
      .map((tab: any) => ({
        title: String(tab?.title || '').trim() || 'Untitled',
        url: normalizeManagedUrl(tab?.url),
        customIcon: String(tab?.icon_url || '').trim(),
        faviconUrl: '',
        isLocked: tab?.is_locked !== false
      }))
      .filter((tab) => !!tab.url);

    const updatedAt = toIsoString(workspace.updated_at) || toIsoString(workspace.published_at) || toIsoString(org.published_at);
    const publishedAt = toIsoString(workspace.published_at) || toIsoString(org.published_at);

    return NextResponse.json({
      version: Number(workspace.version) || 1,
      type: 'dock-managed-config',
      buildFingerprint: BUILD_FINGERPRINT,
      organization: { id: org.id, name: org.name, orgCode: org.org_code, emailDomain: org.email_domain || '' },
      license: {
        plan: org.plan || 'district',
        label: (org.plan || 'district').charAt(0).toUpperCase() + (org.plan || 'district').slice(1),
        maxUsers: org.max_users || 500,
        status: (org as any).license_status || 'trial',
        minimumExtensionVersion: (org as any).minimum_extension_version || null
      },
      workspace: {
        id: workspace.id,
        name: workspace.name,
        version: Number(workspace.version) || 1,
        publishedAt,
        updatedAt,
        branding: {
          districtLogoUrl: String((org as any).district_logo_url || '').trim(),
          districtBackgroundUrl: String((org as any).district_background_url || '').trim(),
          districtAccentColor: String((org as any).district_accent_color || '').trim()
        },
        tabs: normalizedTabs
      },
      profileSync: { ok: true, phase: 'verified', reason: 'current-access-matches-tenant' }
    }, {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': '*',
        'X-Dock-Build-Fingerprint': BUILD_FINGERPRINT
      }
    });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Unknown server error' }, { status: 500 });
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': '*' } });
}
