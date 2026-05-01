import { NextRequest, NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const BUILD_FINGERPRINT = 'bootstrap-verified-domain-debug-v2';
const ORG_CACHE_TTL_MS = 60 * 1000;

type OrgRow = {
  id: string;
  name: string;
  org_code: string;
  email_domain: string | null;
  plan: string | null;
  max_users: number | null;
};

type ProfileSyncResult = {
  ok: boolean;
  phase: string;
  reason: string;
  details?: Record<string, unknown> | null;
};

let serviceSupabaseSingleton: SupabaseClient | null = null;
let authSupabaseSingleton: SupabaseClient | null = null;
const orgCache = new Map<string, { ts: number; org: OrgRow }>();

function getServiceSupabase() {
  if (serviceSupabaseSingleton) return serviceSupabaseSingleton;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url) throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL');
  if (!serviceRoleKey) throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY');

  serviceSupabaseSingleton = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  return serviceSupabaseSingleton;
}

function getAuthSupabase() {
  if (authSupabaseSingleton) return authSupabaseSingleton;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url) throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL');
  if (!anonKey) throw new Error('Missing NEXT_PUBLIC_SUPABASE_ANON_KEY');

  authSupabaseSingleton = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  return authSupabaseSingleton;
}

function normalize(value: unknown): string {
  return String(value || '').trim();
}

function normalizeDomain(value: unknown): string {
  const raw = normalize(value).toLowerCase();
  if (!raw) return '';
  if (raw.includes('@')) {
    const parts = raw.split('@');
    return normalize(parts[parts.length - 1]).toLowerCase();
  }
  return raw;
}

function extractOrgFromDomainRecord(record: any): OrgRow | null {
  const joined = record?.organizations;
  if (Array.isArray(joined)) return (joined[0] || null) as OrgRow | null;
  return (joined || null) as OrgRow | null;
}

function buildOrgCacheKey(requestedOrgCode: string, emailDomain: string) {
  return requestedOrgCode ? `org:${requestedOrgCode}` : `domain:${emailDomain}`;
}

async function resolveOrganization(
  supabase: SupabaseClient,
  requestedOrgCode: string,
  emailDomain: string
) {
  const normalizedEmailDomain = normalizeDomain(emailDomain);
  const cacheKey = buildOrgCacheKey(requestedOrgCode, normalizedEmailDomain);
  const cached = orgCache.get(cacheKey);
  if (cached && (Date.now() - cached.ts) < ORG_CACHE_TTL_MS) {
    return {
      data: cached.org,
      error: null,
      cacheHit: true,
      source: requestedOrgCode ? 'org-code' : 'verified-domain',
      domainRecord: null as any
    };
  }

  if (requestedOrgCode) {
    const { data, error } = await supabase
      .from('organizations')
      .select('id, name, org_code, email_domain, plan, max_users')
      .eq('org_code', requestedOrgCode)
      .maybeSingle();

    if (!error && data) {
      orgCache.set(cacheKey, { ts: Date.now(), org: data as OrgRow });
    }

    return {
      data: (data as OrgRow | null),
      error,
      cacheHit: false,
      source: 'org-code',
      domainRecord: null as any
    };
  }

  if (!normalizedEmailDomain) {
    return {
      data: null,
      error: null,
      cacheHit: false,
      source: 'missing-domain',
      domainRecord: null as any
    };
  }

  const { data: domainRecord, error } = await supabase
    .from('organization_domains')
    .select(`
      organization_id,
      domain,
      normalized_domain,
      status,
      domain_type,
      organizations (
        id,
        name,
        org_code,
        email_domain,
        plan,
        max_users
      )
    `)
    .eq('normalized_domain', normalizedEmailDomain)
    .eq('status', 'verified')
    .maybeSingle();

  if (error) {
    return {
      data: null,
      error,
      cacheHit: false,
      source: 'verified-domain',
      domainRecord: null as any
    };
  }

  const org = extractOrgFromDomainRecord(domainRecord);
  if (org) {
    orgCache.set(cacheKey, { ts: Date.now(), org });
  }

  return {
    data: org,
    error: null,
    cacheHit: false,
    source: 'verified-domain',
    domainRecord: domainRecord || null
  };
}

async function syncProfileIfPossible(
  supabase: SupabaseClient,
  userId: string,
  userEmail: string,
  org: { id: string }
): Promise<ProfileSyncResult> {
  if (!userId || !org?.id) {
    return {
      ok: false,
      phase: 'precheck',
      reason: 'missing-user-or-org',
      details: { userIdPresent: !!userId, orgIdPresent: !!org?.id }
    };
  }

  const { data: existing, error: existingError } = await supabase
    .from('profiles')
    .select('id, role, organization_id, email')
    .eq('id', userId)
    .maybeSingle();

  if (existingError) {
    return {
      ok: false,
      phase: 'select-existing',
      reason: existingError.message,
      details: { code: (existingError as any)?.code || null, hint: (existingError as any)?.hint || null }
    };
  }

  const normalizedEmail = userEmail || null;
  const normalizedRole = normalize(existing?.role) || 'member';
  const sameOrg = normalize(existing?.organization_id) === org.id;
  const sameEmail = normalize(existing?.email) === normalize(normalizedEmail);
  const sameRole = normalize(existing?.role) === normalizedRole;

  if (existing?.id && sameOrg && sameEmail && sameRole) {
    return {
      ok: true,
      phase: 'noop',
      reason: 'unchanged',
      details: { existing }
    };
  }

  const payload = {
    id: userId,
    email: normalizedEmail,
    organization_id: org.id,
    role: normalizedRole,
  };

  const { data: upserted, error: profileError } = await supabase
    .from('profiles')
    .upsert(payload, { onConflict: 'id' })
    .select('id, email, organization_id, role')
    .maybeSingle();

  if (profileError) {
    return {
      ok: false,
      phase: 'upsert',
      reason: profileError.message,
      details: { code: (profileError as any)?.code || null, hint: (profileError as any)?.hint || null, payload }
    };
  }

  return {
    ok: true,
    phase: existing?.id ? 'updated' : 'inserted',
    reason: existing?.id ? 'updated' : 'inserted',
    details: { payload, existing: existing || null, saved: upserted || null }
  };
}

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const requestedOrgCode = normalize(url.searchParams.get('orgCode'));
    const requestedDomain = normalizeDomain(url.searchParams.get('domain'));

    const supabase = getServiceSupabase();
    const authSupabase = getAuthSupabase();

    const authHeader = request.headers.get('authorization') || request.headers.get('Authorization') || '';
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();

    let userEmail = '';
    let userId = '';
    let authStatus = 'missing-token';

    if (token) {
      const { data: { user }, error: userError } = await authSupabase.auth.getUser(token);

      if (userError || !user) {
        authStatus = 'invalid-token';
      } else {
        authStatus = 'authenticated';
        userId = normalize(user.id);
        userEmail = normalize(user.email).toLowerCase();
      }
    }

    const emailDomain = requestedDomain || normalizeDomain(userEmail);

    if (!requestedOrgCode && !emailDomain) {
      return NextResponse.json({ error: 'Missing orgCode or domain' }, { status: 400 });
    }

    const { data: org, error: orgError, cacheHit, source: resolutionSource, domainRecord } = await resolveOrganization(supabase, requestedOrgCode, emailDomain);

    if (orgError) {
      return NextResponse.json({ error: orgError.message }, { status: 500 });
    }

    if (!org) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
    }

    let profileSync: ProfileSyncResult;
    if (userId) {
      profileSync = await syncProfileIfPossible(supabase, userId, userEmail, org);
      if (!profileSync.ok) {
        console.error('BOOTSTRAP profile sync failed:', profileSync.reason, profileSync.details || null);
      }
    } else {
      profileSync = {
        ok: false,
        phase: 'skipped',
        reason: authStatus,
        details: {
          hasAuthorizationHeader: !!authHeader,
          tokenPresent: !!token,
        }
      };
    }

    const origin = url.origin;
    const configUrl = `${origin}/api/org/${encodeURIComponent(org.org_code)}/workspace`;
    const timestamp = new Date().toISOString();
    const responsePayload = {
      organization: {
        id: org.id,
        name: org.name,
        orgCode: org.org_code,
        emailDomain: org.email_domain || emailDomain,
      },
      organizationName: org.name,
      orgCode: org.org_code,
      emailDomain: org.email_domain || emailDomain,
      configUrl,
      workspacePath: `/api/org/${encodeURIComponent(org.org_code)}/workspace`,
      apiBaseUrl: origin,
      license: org.plan || 'free',
      syncMode: resolutionSource,
      buildFingerprint: BUILD_FINGERPRINT,
      liveRoutePatched: true,
      domainResolution: {
        source: resolutionSource,
        strategy: resolutionSource === 'verified-domain' ? 'verified-domain-registry' : resolutionSource,
        lookupTable: resolutionSource === 'verified-domain' ? 'organization_domains' : 'organizations',
        lookupColumn: resolutionSource === 'verified-domain' ? 'normalized_domain' : 'org_code',
        requiredStatus: resolutionSource === 'verified-domain' ? 'verified' : null,
        verified: resolutionSource === 'verified-domain',
        domainRegistryMatched: resolutionSource === 'verified-domain',
        domain: domainRecord?.normalized_domain || emailDomain || null,
        domainType: domainRecord?.domain_type || null,
        organizationId: domainRecord?.organization_id || org.id,
      },
      profileSync,
      debug: {
        route: '/api/bootstrap',
        buildFingerprint: BUILD_FINGERPRINT,
        liveRoutePatched: true,
        requestedOrgCode: requestedOrgCode || null,
        requestedDomain: requestedDomain || null,
        resolvedEmailDomain: emailDomain || null,
        resolutionSource,
        verifiedDomainDebugLabel: resolutionSource === 'verified-domain' ? 'verified-domain-registry:organization_domains' : resolutionSource,
        domainRegistryLookupTable: resolutionSource === 'verified-domain' ? 'organization_domains' : null,
        domainRegistryLookupStatus: resolutionSource === 'verified-domain' ? 'verified' : null,
        domainRegistryMatched: resolutionSource === 'verified-domain',
        hasAuthorizationHeader: !!authHeader,
        tokenPresent: !!token,
        authStatus,
        resolvedUserId: userId || null,
        resolvedUserEmail: userEmail || null,
        resolvedOrgId: org.id,
        resolvedOrgCode: org.org_code,
        profileSyncPhase: profileSync?.phase || null,
        profileSyncReason: profileSync?.reason || null,
        cacheHit,
        hasAnonKey: !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
        hasServiceRoleKey: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
        timestamp,
      },
    };

    return NextResponse.json(responsePayload, {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        'X-Dock-Build-Fingerprint': BUILD_FINGERPRINT,
        'X-Dock-Live-Route': 'true',
      }
    });
  } catch (err: any) {
    console.error('BOOTSTRAP fatal error:', err);
    return NextResponse.json(
      {
        error: err?.message || 'Unknown error',
        buildFingerprint: BUILD_FINGERPRINT,
        liveRoutePatched: true,
      },
      { status: 500 }
    );
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': '*'
    }
  });
}
