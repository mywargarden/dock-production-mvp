import { NextRequest, NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Buffer } from 'buffer';

let serviceSupabaseSingleton: SupabaseClient | null = null;
let authSupabaseSingleton: SupabaseClient | null = null;
const orgIdCache = new Map<string, { id: string; ts: number }>();
const ORG_CACHE_TTL_MS = 60 * 1000;

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

async function requireUser(request: NextRequest) {
  const authHeader = request.headers.get('authorization') || request.headers.get('Authorization') || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) {
    return { error: NextResponse.json({ error: 'Missing bearer token' }, { status: 401 }) };
  }

  const auth = getAuthSupabase();
  const { data, error } = await auth.auth.getUser(token);
  if (error || !data?.user?.id) {
    console.error('Dock /api/user/memories invalid auth token', error?.message || 'no-user');
    return { error: NextResponse.json({ error: 'Invalid auth token' }, { status: 401 }) };
  }

  return { user: data.user, token };
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

function extractOrganizationIdFromDomainRecord(record: any): string {
  const direct = normalize(record?.organization_id);
  if (direct) return direct;
  const joined = record?.organizations;
  const org = Array.isArray(joined) ? joined[0] : joined;
  return normalize(org?.id);
}


const JUNK_QUERY_PARAMS = new Set([
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
  'utm_id', 'utm_name', 'utm_cid', 'utm_reader', 'utm_viz_id',
  'fbclid', 'gclid', 'dclid', 'gbraid', 'wbraid', 'igshid',
  'mc_cid', 'mc_eid', 'ref', 'ref_src', 'source'
]);

function normalizeMemoryUrl(value: unknown): string {
  const raw = normalize(value);
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    const protocol = parsed.protocol.toLowerCase();
    if (!['http:', 'https:'].includes(protocol)) return '';

    parsed.protocol = protocol;
    parsed.hostname = parsed.hostname.toLowerCase();
    parsed.hash = '';

    if ((protocol === 'http:' && parsed.port === '80') || (protocol === 'https:' && parsed.port === '443')) {
      parsed.port = '';
    }

    const kept: Array<[string, string]> = [];
    for (const [key, val] of Array.from(parsed.searchParams.entries())) {
      if (!JUNK_QUERY_PARAMS.has(String(key || '').toLowerCase())) kept.push([key, val]);
    }
    kept.sort((a, b) => {
      const keyCompare = a[0].localeCompare(b[0]);
      return keyCompare !== 0 ? keyCompare : a[1].localeCompare(b[1]);
    });
    parsed.search = '';
    for (const [key, val] of kept) parsed.searchParams.append(key, val);

    if (parsed.pathname !== '/') parsed.pathname = parsed.pathname.replace(/\/+$/, '');

    let href = parsed.toString();
    if (href.endsWith('/') && parsed.pathname !== '/') href = href.slice(0, -1);
    return href;
  } catch {
    return '';
  }
}

function isDockInternalPath(pathname: unknown): boolean {
  const path = String(pathname || '/').toLowerCase();
  return (
    path === '/' ||
    path === '/admin' ||
    path.startsWith('/admin/') ||
    path === '/api/bootstrap' ||
    /^\/api\/org\/[^/]+\/workspace\/?$/i.test(path) ||
    /^\/api\/user\/memories\/?$/i.test(path)
  );
}

function isLogoutLikePath(pathname: unknown): boolean {
  const path = String(pathname || '/').toLowerCase();
  return /(^|\/)(log(?:out|off)|sign(?:out|off))(\/|$)/i.test(path);
}

function shouldExcludeMemoryUrl(value: unknown): boolean {
  const raw = normalize(value).toLowerCase();
  if (!raw) return true;
  if (/^(chrome|edge|about|file|blob|data|devtools):/i.test(raw)) return true;
  if (raw.startsWith('chrome-extension://') || raw.startsWith('safari-extension://')) return true;
  if (raw.includes('chromewebstore.google.com')) return true;
  if (raw === 'chrome://newtab' || raw === 'chrome://newtab/' || raw === 'about:blank') return true;
  if (/^https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0)(?::\d+)?(?:\/|$)/i.test(raw)) return true;

  try {
    const parsed = new URL(raw);
    const host = parsed.hostname.toLowerCase();
    const path = parsed.pathname || '/';

    if (host === 'dock-production-mvp.vercel.app' && isDockInternalPath(path)) return true;
    if (isLogoutLikePath(path)) return true;
  } catch {
    return true;
  }

  return false;
}

async function resolveOrganizationId(
  supabase: SupabaseClient,
  request: NextRequest,
  user: { email?: string | null }
) {
  const hintedOrgCode = normalize(request.headers.get('x-dock-org-code'));
  const email = normalize(user?.email).toLowerCase();
  const emailDomain = normalizeDomain(email);
  const cacheKey = hintedOrgCode ? `org:${hintedOrgCode}` : `domain:${emailDomain}`;
  const cached = orgIdCache.get(cacheKey);
  if (cached && (Date.now() - cached.ts) < ORG_CACHE_TTL_MS) {
    return cached.id;
  }

  if (hintedOrgCode) {
    const { data: byCode } = await supabase
      .from('organizations')
      .select('id')
      .eq('org_code', hintedOrgCode)
      .maybeSingle();
    if (byCode?.id) {
      orgIdCache.set(cacheKey, { id: byCode.id, ts: Date.now() });
      return byCode.id;
    }
  }

  if (!emailDomain) return '';

  const { data: byVerifiedDomain, error } = await supabase
    .from('organization_domains')
    .select('organization_id, normalized_domain, status, organizations ( id )')
    .eq('normalized_domain', emailDomain)
    .eq('status', 'verified')
    .maybeSingle();

  if (error) {
    console.error('Dock ensureProfileForUser verified domain lookup failed', error.message);
    return '';
  }

  const orgId = extractOrganizationIdFromDomainRecord(byVerifiedDomain);
  if (orgId) {
    orgIdCache.set(cacheKey, { id: orgId, ts: Date.now() });
  }
  return orgId;
}

async function ensureProfileForUser(
  supabase: SupabaseClient,
  request: NextRequest,
  user: { id: string; email?: string | null }
) {
  const userId = normalize(user?.id);
  const email = normalize(user?.email).toLowerCase();
  if (!userId) return { ok: false, reason: 'missing-user-id' };

  const orgId = await resolveOrganizationId(supabase, request, user);

  const { data: existing, error: existingError } = await supabase
    .from('profiles')
    .select('id, role, organization_id, email')
    .eq('id', userId)
    .maybeSingle();

  if (existingError) {
    console.error('Dock ensureProfileForUser existing profile lookup failed', existingError.message);
    return { ok: false, reason: existingError.message };
  }

  const organizationId = orgId || normalize(existing?.organization_id);
  if (!organizationId) {
    return { ok: false, reason: 'no-organization-match' };
  }

  const nextRole = normalize(existing?.role) || 'member';
  const sameOrg = normalize(existing?.organization_id) === organizationId;
  const sameEmail = normalize(existing?.email) === email;
  const sameRole = normalize(existing?.role) === nextRole;

  if (existing?.id && sameOrg && sameEmail && sameRole) {
    return { ok: true, reason: 'unchanged' };
  }

  const payload = {
    id: userId,
    email: email || null,
    organization_id: organizationId,
    role: nextRole
  };

  const { error: profileError } = await supabase
    .from('profiles')
    .upsert(payload, { onConflict: 'id' });

  if (profileError) {
    console.error('Dock ensureProfileForUser upsert failed', profileError.message);
    return { ok: false, reason: profileError.message };
  }

  return { ok: true, reason: existing?.id ? 'updated' : 'inserted' };
}

function sanitizeText(value: unknown, max = 500) {
  return String(value || '').trim().slice(0, max);
}

function sanitizeLongText(value: unknown, max = 2_000_000) {
  return String(value || '').trim().slice(0, max);
}

function sanitizePersonalIconUrl(value: unknown, max = 500) {
  const raw = String(value || '').trim();
  if (!raw || /^data:/i.test(raw)) return '';
  try {
    const parsed = new URL(raw);
    if (!['http:', 'https:'].includes(parsed.protocol)) return '';
    parsed.hash = '';
    return parsed.toString().slice(0, max);
  } catch {
    return '';
  }
}

function sanitizeScreenshotDataUrl(value: unknown, max = 5_000_000): { value: string; error?: string } {
  const raw = String(value || '').trim();
  if (!raw) return { value: '' };
  if (raw.length > max) return { value: '', error: 'SCREENSHOT_TOO_LARGE' };
  if (!/^data:image\/(?:png|jpeg|jpg|webp);base64,/i.test(raw)) {
    return { value: '', error: 'INVALID_SCREENSHOT_DATA_URL' };
  }
  return { value: raw };
}


async function uploadScreenshotToStorage(supabase: any, userId: string, screenshotDataUrl: string): Promise<string> {
  const raw = String(screenshotDataUrl || '').trim();
  if (!raw || !raw.startsWith('data:image/')) return '';

  const match = raw.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!match) return '';

  const contentType = match[1];
  const base64 = match[2];
  const buffer = Buffer.from(base64, 'base64');
  if (!buffer.length || buffer.length > 5_000_000) return '';

  const ext = contentType.includes('jpeg') || contentType.includes('jpg')
    ? 'jpg'
    : contentType.includes('webp')
      ? 'webp'
      : 'png';

  const filePath = `${userId}/${crypto.randomUUID()}.${ext}`;

  const { error } = await supabase.storage
    .from('memory-screenshots')
    .upload(filePath, buffer, { contentType, upsert: true });

  if (error) {
    console.error('Dock screenshot storage upload failed', error.message);
    return '';
  }

  const { data } = supabase.storage
    .from('memory-screenshots')
    .getPublicUrl(filePath);

  return String(data?.publicUrl || '').trim();
}

function wantsScreenshots(request: NextRequest) {
  const value = String(request.nextUrl.searchParams.get('includeScreenshots') || '').trim().toLowerCase();
  return value === '1' || value === 'true' || value === 'yes' || value === 'full';
}

function memorySelect(_includeScreenshots = false) {
  // Production invariant: full screenshot base64 is upload-only.
  // List/detail reads return screenshot_url, never screenshot_data_url.
  return 'id,user_id,title,url,icon_url,screenshot_url,screenshot_blocked,reason,local_id,created_at,updated_at,deleted_at';
}

function jsonWithSize(body: any, init: ResponseInit = {}) {
  const text = JSON.stringify(body);
  console.log('Dock /api/user/memories response bytes', {
    bytes: Buffer.byteLength(text, 'utf8'),
    count: Array.isArray(body?.memories) ? body.memories.length : undefined,
    hasNextCursor: Boolean(body?.nextCursor),
    updatedSince: body?.updatedSince || null
  });
  return new NextResponse(text, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init.headers || {})
    }
  });
}

export async function GET(request: NextRequest) {
  try {
    const authResult = await requireUser(request);
    if (authResult.error) return authResult.error;

    const supabase = getServiceSupabase();
    const userId = authResult.user!.id;
    const includeScreenshots = wantsScreenshots(request);
    const profileSync = await ensureProfileForUser(supabase, request, authResult.user!);

    const rawLimit = Number(request.nextUrl.searchParams.get('limit') || 50);
    const limit = Math.min(Math.max(Number.isFinite(rawLimit) ? rawLimit : 50, 1), 100);
    const updatedSince = normalize(request.nextUrl.searchParams.get('updatedSince'));
    const cursor = normalize(request.nextUrl.searchParams.get('cursor'));

    let query = supabase
      .from('personal_memories')
      .select(memorySelect(includeScreenshots))
      .eq('user_id', userId)
      .is('deleted_at', null)
      .order('updated_at', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(limit + 1);

    if (updatedSince) query = query.gt('updated_at', updatedSince);
    if (cursor) query = query.lt('updated_at', cursor);

    const { data, error } = await query;

    if (error) {
      console.error('Dock /api/user/memories GET failed', error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const rows = (data || []) as any[];
    const memories = rows.slice(0, limit);
    const nextCursor = rows.length > limit ? normalize((memories[memories.length - 1] as any)?.updated_at) : null;
    const serverTime = new Date().toISOString();

    return jsonWithSize({
      user_id: userId,
      count: memories.length,
      includeScreenshots: false,
      updatedSince: updatedSince || null,
      nextCursor,
      serverTime,
      profileSync,
      memories
    }, {
      headers: {
        'Cache-Control': 'private, max-age=30, stale-while-revalidate=120'
      }
    });
  } catch (error: any) {
    console.error('Dock /api/user/memories GET exception', error?.message || error);
    return NextResponse.json(
      { error: error?.message || 'Unknown server error' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const authResult = await requireUser(request);
    if (authResult.error) return authResult.error;

    const supabase = getServiceSupabase();
    const userId = authResult.user!.id;
    const profileSync = await ensureProfileForUser(supabase, request, authResult.user!);
    const body = await request.json();

    const title = sanitizeText(body?.title, 120);
    const url = normalizeMemoryUrl(body?.url);
    const icon_url = sanitizePersonalIconUrl(body?.icon_url);
    const screenshotResult = sanitizeScreenshotDataUrl(body?.screenshot_data_url, 5_000_000);
    if (screenshotResult.error === 'SCREENSHOT_TOO_LARGE') {
      return NextResponse.json({ error: 'SCREENSHOT_TOO_LARGE' }, { status: 413 });
    }
    if (screenshotResult.error === 'INVALID_SCREENSHOT_DATA_URL') {
      return NextResponse.json({ error: 'INVALID_SCREENSHOT_DATA_URL' }, { status: 400 });
    }
    const screenshot_data_url = screenshotResult.value;
    let screenshot_url = sanitizeLongText(body?.screenshot_url, 2000);
    if (!screenshot_url && screenshot_data_url) {
      screenshot_url = await uploadScreenshotToStorage(supabase, userId, screenshot_data_url);
    }
    const screenshot_blocked = Boolean(body?.screenshot_blocked);
    const reason = sanitizeText(body?.reason, 500);
    const local_id = sanitizeText(body?.local_id, 120);

    if (!url) {
      return NextResponse.json({ error: 'URL is required' }, { status: 400 });
    }

    if (shouldExcludeMemoryUrl(url)) {
      return NextResponse.json({ error: 'Excluded internal URL', skipped: true, url }, { status: 202 });
    }

    const nowIso = new Date().toISOString();

    const { data: existingRows, error: existingError } = await supabase
      .from('personal_memories')
      .select('id, local_id, title, icon_url, screenshot_url, screenshot_blocked, reason, created_at, updated_at, deleted_at')
      .eq('user_id', userId)
      .eq('url', url)
      .is('deleted_at', null)
      .order('updated_at', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(100);

    if (existingError) {
      console.error('Dock /api/user/memories POST existing lookup failed', existingError.message);
      return NextResponse.json({ error: existingError.message }, { status: 500 });
    }

    const existingMatches = Array.isArray(existingRows) ? existingRows : [];
    const keeper = existingMatches[0] || null;
    const duplicateIds = existingMatches.slice(1).map((row) => normalize(row?.id)).filter(Boolean);

    const firstNonEmpty = (...values: unknown[]) => {
      for (const value of values) {
        const next = normalize(value);
        if (next) return next;
      }
      return '';
    };

    const mergedTitle = firstNonEmpty(title, ...existingMatches.map((row) => row?.title));
    const mergedIconUrl = firstNonEmpty(icon_url, ...existingMatches.map((row) => row?.icon_url));
    const mergedScreenshotUrl = firstNonEmpty(screenshot_url, ...existingMatches.map((row) => row?.screenshot_url));
    // Do not carry old row-level base64 forward. Full screenshots are upload-only; durable previews use screenshot_url.
    const mergedScreenshot = '';
    const mergedReason = firstNonEmpty(reason, ...existingMatches.map((row) => row?.reason));
    const mergedLocalId = firstNonEmpty(local_id, ...existingMatches.map((row) => row?.local_id), url);
    const mergedScreenshotBlocked = (mergedScreenshotUrl || mergedScreenshot) ? false : (screenshot_blocked || existingMatches.some((row) => Boolean(row?.screenshot_blocked)));

    const nooped =
      Boolean(keeper?.id) &&
      duplicateIds.length === 0 &&
      normalize(keeper?.title) === mergedTitle &&
      normalize(keeper?.icon_url) === mergedIconUrl &&
      normalize(keeper?.screenshot_url) === mergedScreenshotUrl &&
      Boolean(keeper?.screenshot_blocked) === mergedScreenshotBlocked &&
      normalize(keeper?.reason) === mergedReason &&
      normalize(keeper?.local_id) === mergedLocalId;

    if (nooped) {
      const { data, error } = await supabase
        .from('personal_memories')
        .select(memorySelect(false))
        .eq('id', keeper.id)
        .eq('user_id', userId)
        .single();

      if (error) {
        console.error('Dock /api/user/memories POST no-op fetch failed', error.message);
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      return NextResponse.json({ user_id: userId, memory: data, upserted: true, nooped: true, duplicatesCollapsed: 0, profileSync });
    }

    let persisted;

    if (keeper?.id) {
      const { data, error } = await supabase
        .from('personal_memories')
        .update({
          title: mergedTitle,
          url,
          icon_url: mergedIconUrl || null,
          screenshot_url: mergedScreenshotUrl || null,
          screenshot_data_url: null,
          screenshot_blocked: mergedScreenshotBlocked,
          reason: mergedReason || null,
          local_id: mergedLocalId || null,
          deleted_at: null,
          updated_at: nowIso
        })
        .eq('id', keeper.id)
        .eq('user_id', userId)
        .select(memorySelect(false))
        .single();

      if (error) {
        console.error('Dock /api/user/memories POST update failed', error.message);
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      persisted = data;
    } else {
      const { data, error } = await supabase
        .from('personal_memories')
        .insert({
          user_id: userId,
          title: mergedTitle,
          url,
          icon_url: mergedIconUrl || null,
          screenshot_url: mergedScreenshotUrl || null,
          screenshot_data_url: null,
          screenshot_blocked: mergedScreenshotBlocked,
          reason: mergedReason || null,
          local_id: mergedLocalId || null,
          deleted_at: null,
          updated_at: nowIso
        })
        .select(memorySelect(false))
        .single();

      if (error) {
        console.error('Dock /api/user/memories POST insert failed', error.message);
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      persisted = data;
    }

    if (duplicateIds.length) {
      const { error: collapseError } = await supabase
        .from('personal_memories')
        .update({ deleted_at: nowIso, updated_at: nowIso })
        .in('id', duplicateIds)
        .eq('user_id', userId);

      if (collapseError) {
        console.error('Dock /api/user/memories POST duplicate collapse failed', collapseError.message);
      }
    }

    return NextResponse.json({
      user_id: userId,
      memory: persisted,
      upserted: true,
      duplicatesCollapsed: duplicateIds.length,
      profileSync
    });
  } catch (error: any) {
    console.error('Dock /api/user/memories POST exception', error?.message || error);
    return NextResponse.json(
      { error: error?.message || 'Unknown server error' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const authResult = await requireUser(request);
    if (authResult.error) return authResult.error;

    const supabase = getServiceSupabase();
    const userId = authResult.user!.id;
    const profileSync = await ensureProfileForUser(supabase, request, authResult.user!);

    // Be intentionally tolerant here. Different extension builds have sent deletes as:
    //   DELETE /api/user/memories?url=...
    //   DELETE /api/user/memories with { url }
    //   DELETE /api/user/memories?id=...
    //   headers x-memory-url / x-dock-memory-url
    // Accept all of them so deleted memories cannot be resurrected by hydration.
    let body: any = {};
    let rawBody = '';
    try {
      rawBody = await request.text();
      body = rawBody ? JSON.parse(rawBody) : {};
    } catch {
      body = {};
    }

    let parsedUrl: URL | null = null;
    try { parsedUrl = new URL(request.url); } catch { parsedUrl = null; }
    const search = parsedUrl?.searchParams || request.nextUrl.searchParams;

    const first = (...values: unknown[]) => {
      for (const value of values) {
        const next = normalize(value);
        if (next) return next;
      }
      return '';
    };

    const memoryId = first(
      search.get('id'),
      search.get('memory_id'),
      search.get('memoryId'),
      request.headers.get("x-memory-id"),
      request.headers.get("x-dock-memory-id"),
      body?.id,
      body?.memory_id,
      body?.memoryId
    );

    // Also manually parse the raw query string as a belt-and-suspenders fallback.
    let rawQueryUrl = '';
    try {
      const rawSearch = String(parsedUrl?.search || '').replace(/^\?/, '');
      for (const part of rawSearch.split('&')) {
        const eq = part.indexOf('=');
        const key = eq >= 0 ? part.slice(0, eq) : part;
        if (decodeURIComponent(key || '') === 'url') {
          rawQueryUrl = decodeURIComponent(eq >= 0 ? part.slice(eq + 1) : '');
          break;
        }
      }
    } catch {}

    const rawUrl = first(
      search.get('url'),
      rawQueryUrl,
      request.headers.get('x-memory-url'),
      request.headers.get('x-dock-memory-url'),
      body?.url,
      body?.memory_url,
      body?.memoryUrl
    );
    const normalizedUrl = normalizeMemoryUrl(rawUrl);

    if (!memoryId && !rawUrl && !normalizedUrl) {
      return NextResponse.json({
        error: 'Missing memory id or url',
        acceptedInputs: ['?url=', '?id=', 'json.url', 'json.id', 'x-memory-url', 'x-dock-memory-url']
      }, { status: 400 });
    }

    let query = supabase
      .from('personal_memories')
      .delete()
      .eq('user_id', userId);

    if (memoryId) {
      query = query.eq('id', memoryId);
    } else {
      // Delete by exact stored URL first. If this misses because an older row retained
      // a hash/query variant, fall back to a small user-scoped lookup below.
      query = query.eq('url', rawUrl || normalizedUrl);
    }

    let { data, error } = await query.select('id,url');

    if (error) {
      console.error('Dock /api/user/memories DELETE primary failed', error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    let deletedRows = data || [];

    if (!memoryId && !deletedRows.length && normalizedUrl) {
      const { data: rows, error: lookupError } = await supabase
        .from('personal_memories')
        .select('id,url')
        .eq('user_id', userId)
        .limit(5000);

      if (lookupError) {
        console.error('Dock /api/user/memories DELETE fallback lookup failed', lookupError.message);
        return NextResponse.json({ error: lookupError.message }, { status: 500 });
      }

      const rawLower = rawUrl.toLowerCase();
      const normalizedLower = normalizedUrl.toLowerCase();
      const targetIds = (rows || [])
        .filter((row: any) => {
          const rowUrl = normalize(row?.url);
          const rowNormalized = normalizeMemoryUrl(rowUrl);
          return (
            (!!rawLower && rowUrl.toLowerCase() === rawLower) ||
            (!!normalizedLower && rowNormalized.toLowerCase() === normalizedLower)
          );
        })
        .map((row: any) => normalize(row?.id))
        .filter(Boolean);

      if (targetIds.length) {
        const fallback = await supabase
          .from('personal_memories')
          .delete()
          .eq('user_id', userId)
          .in('id', targetIds)
          .select('id,url');

        if (fallback.error) {
          console.error('Dock /api/user/memories DELETE fallback failed', fallback.error.message);
          return NextResponse.json({ error: fallback.error.message }, { status: 500 });
        }

        deletedRows = fallback.data || [];
      }
    }

    return NextResponse.json({
      user_id: userId,
      ok: true,
      deletedCount: deletedRows.length,
      deleted: deletedRows,
      requested: { id: memoryId || null, rawUrl, normalizedUrl },
      profileSync
    });
  } catch (error: any) {
    console.error('Dock /api/user/memories DELETE exception', error?.message || error);
    return NextResponse.json(
      { error: error?.message || 'Unknown server error' },
      { status: 500 }
    );
  }
}
