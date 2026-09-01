import { NextRequest, NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Buffer } from 'buffer';

let serviceSupabaseSingleton: SupabaseClient | null = null;
let authSupabaseSingleton: SupabaseClient | null = null;

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
  if (!token) return { error: NextResponse.json({ error: 'Missing bearer token', code: 'AUTH_REQUIRED' }, { status: 401 }) };

  const auth = getAuthSupabase();
  const { data, error } = await auth.auth.getUser(token);
  if (error || !data?.user?.id) {
    console.error('Dock /api/user/memories invalid auth token', error?.message || 'no-user');
    return { error: NextResponse.json({ error: 'Invalid auth token', code: 'INVALID_AUTH_TOKEN' }, { status: 401 }) };
  }
  return { user: data.user };
}

async function requireCurrentAccess(service: SupabaseClient, userId: string) {
  const { data: allowed, error } = await service.rpc('dock_user_access_allowed', {
    p_user_id: userId,
    p_organization_id: null
  });
  if (error) {
    console.error('Dock current-access check failed', error.message);
    return { error: NextResponse.json({ error: 'Could not verify Dock access.', code: 'ACCESS_CHECK_FAILED' }, { status: 500 }) };
  }
  if (!allowed) {
    return { error: NextResponse.json({ error: 'Dock access is disabled or unauthorized.', code: 'ACCESS_DENIED' }, { status: 403 }) };
  }
  return { profileSync: { ok: true, phase: 'verified', reason: 'current-access' } };
}

function normalize(value: unknown): string {
  return String(value || '').trim();
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
    if ((protocol === 'http:' && parsed.port === '80') || (protocol === 'https:' && parsed.port === '443')) parsed.port = '';

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
    path === '/' || path === '/admin' || path.startsWith('/admin/') ||
    path === '/api/bootstrap' ||
    /^\/api\/org\/[^/]+\/workspace\/?$/i.test(path) ||
    /^\/api\/user\/memories\/?$/i.test(path) ||
    /^\/api\/user\/memory-screenshot\/?$/i.test(path)
  );
}

function isLogoutLikePath(pathname: unknown): boolean {
  return /(^|\/)(log(?:out|off)|sign(?:out|off))(\/|$)/i.test(String(pathname || '/').toLowerCase());
}

function shouldExcludeMemoryUrl(value: unknown): boolean {
  const raw = normalize(value).toLowerCase();
  if (!raw) return true;
  if (/^(chrome|edge|about|file|blob|data|devtools):/i.test(raw)) return true;
  if (raw.startsWith('chrome-extension://') || raw.startsWith('safari-extension://')) return true;
  if (raw.includes('chromewebstore.google.com')) return true;
  if (/^https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0)(?::\d+)?(?:\/|$)/i.test(raw)) return true;
  try {
    const parsed = new URL(raw);
    if (parsed.hostname.toLowerCase() === 'dock-production-mvp.vercel.app' && isDockInternalPath(parsed.pathname || '/')) return true;
    if (isLogoutLikePath(parsed.pathname || '/')) return true;
  } catch {
    return true;
  }
  return false;
}

function sanitizeText(value: unknown, max = 500) {
  return String(value || '').trim().slice(0, max);
}

function sanitizePersonalIconUrl(value: unknown, max = 500) {
  const raw = normalize(value);
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

function sanitizeScreenshotUrl(value: unknown, max = 2000) {
  const raw = normalize(value);
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

function sanitizeScreenshotDataUrl(value: unknown, max = 750_000): { value: string; error?: string } {
  const raw = normalize(value);
  if (!raw) return { value: '' };
  if (raw.length > max) return { value: '', error: 'SCREENSHOT_TOO_LARGE' };
  if (!/^data:image\/(?:png|jpeg|jpg|webp);base64,/i.test(raw)) return { value: '', error: 'INVALID_SCREENSHOT_DATA_URL' };
  return { value: raw };
}

type UploadedScreenshot = { path: string; publicUrl: string };

async function uploadScreenshotToStorage(
  supabase: SupabaseClient,
  userId: string,
  screenshotDataUrl: string
): Promise<UploadedScreenshot | null> {
  const raw = normalize(screenshotDataUrl);
  const match = raw.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!match) return null;

  const contentType = match[1];
  const buffer = Buffer.from(match[2], 'base64');
  if (!buffer.length || buffer.length > 600_000) return null;

  const ext = contentType.includes('jpeg') || contentType.includes('jpg') ? 'jpg' : contentType.includes('webp') ? 'webp' : 'png';
  const path = `${userId}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from('memory-screenshots').upload(path, buffer, { contentType, upsert: false });
  if (error) {
    console.error('Dock screenshot storage upload failed', error.message);
    return null;
  }
  const { data } = supabase.storage.from('memory-screenshots').getPublicUrl(path);
  return { path, publicUrl: normalize(data?.publicUrl) };
}

async function removeScreenshotPaths(supabase: SupabaseClient, userId: string, values: unknown[]) {
  const prefix = `${userId}/`;
  const paths = Array.from(new Set(values.map(normalize).filter((path) => path.startsWith(prefix))));
  if (!paths.length) return { ok: true, removed: 0 };
  const { error } = await supabase.storage.from('memory-screenshots').remove(paths);
  if (error) {
    console.error('Dock screenshot storage cleanup failed', { count: paths.length, error: error.message });
    return { ok: false, removed: 0, error: error.message };
  }
  return { ok: true, removed: paths.length };
}

const PUBLIC_MEMORY_SELECT = 'id,user_id,title,url,icon_url,screenshot_url,screenshot_blocked,reason,local_id,created_at,updated_at,deleted_at';
const INTERNAL_MEMORY_SELECT = `${PUBLIC_MEMORY_SELECT},screenshot_path`;

function publicMemory(row: any) {
  if (!row || typeof row !== 'object') return row;
  const { screenshot_path: _screenshotPath, ...rest } = row;
  return rest;
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
    headers: { 'Content-Type': 'application/json', ...(init.headers || {}) }
  });
}

export async function GET(request: NextRequest) {
  try {
    const authResult = await requireUser(request);
    if ('error' in authResult) return authResult.error;
    const service = getServiceSupabase();
    const userId = authResult.user.id;
    const access = await requireCurrentAccess(service, userId);
    if ('error' in access) return access.error;

    const rawLimit = Number(request.nextUrl.searchParams.get('limit') || 50);
    const limit = Math.min(Math.max(Number.isFinite(rawLimit) ? rawLimit : 50, 1), 100);
    const updatedSince = normalize(request.nextUrl.searchParams.get('updatedSince'));
    const cursor = normalize(request.nextUrl.searchParams.get('cursor'));

    let query = service
      .from('personal_memories')
      .select(PUBLIC_MEMORY_SELECT)
      .eq('user_id', userId)
      .is('deleted_at', null)
      .order('updated_at', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(limit + 1);
    if (updatedSince) query = query.gt('updated_at', updatedSince);
    if (cursor) query = query.lt('updated_at', cursor);

    const { data, error } = await query;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const rows = data || [];
    const memories = rows.slice(0, limit);
    const nextCursor = rows.length > limit ? normalize(memories[memories.length - 1]?.updated_at) : null;

    return jsonWithSize({
      user_id: userId,
      count: memories.length,
      includeScreenshots: false,
      updatedSince: updatedSince || null,
      nextCursor,
      serverTime: new Date().toISOString(),
      profileSync: access.profileSync,
      memories
    }, { headers: { 'Cache-Control': 'private, max-age=30, stale-while-revalidate=120' } });
  } catch (error: any) {
    console.error('Dock /api/user/memories GET exception', error?.message || error);
    return NextResponse.json({ error: error?.message || 'Unknown server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  let uploaded: UploadedScreenshot | null = null;
  let service: SupabaseClient | null = null;
  let userId = '';
  try {
    const authResult = await requireUser(request);
    if ('error' in authResult) return authResult.error;
    service = getServiceSupabase();
    userId = authResult.user.id;
    const access = await requireCurrentAccess(service, userId);
    if ('error' in access) return access.error;

    const body = await request.json();
    const title = sanitizeText(body?.title, 120);
    const url = normalizeMemoryUrl(body?.url);
    const iconUrl = sanitizePersonalIconUrl(body?.icon_url);
    const incomingScreenshotUrl = sanitizeScreenshotUrl(body?.screenshot_url);
    const screenshotResult = sanitizeScreenshotDataUrl(body?.screenshot_data_url);
    const screenshotBlocked = Boolean(body?.screenshot_blocked);
    const reason = sanitizeText(body?.reason, 500);
    const localId = sanitizeText(body?.local_id, 120);

    if (!url) return NextResponse.json({ error: 'URL is required' }, { status: 400 });
    if (shouldExcludeMemoryUrl(url)) return NextResponse.json({ error: 'Excluded internal URL', skipped: true, url }, { status: 202 });
    if (screenshotResult.error === 'SCREENSHOT_TOO_LARGE') return NextResponse.json({ error: 'SCREENSHOT_TOO_LARGE' }, { status: 413 });
    if (screenshotResult.error === 'INVALID_SCREENSHOT_DATA_URL') return NextResponse.json({ error: 'INVALID_SCREENSHOT_DATA_URL' }, { status: 400 });

    const { data: existingRows, error: existingError } = await service
      .from('personal_memories')
      .select(INTERNAL_MEMORY_SELECT)
      .eq('user_id', userId)
      .eq('url', url)
      .is('deleted_at', null)
      .order('updated_at', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(100);
    if (existingError) return NextResponse.json({ error: existingError.message }, { status: 500 });

    const existing = existingRows || [];
    const keeper = existing[0] || null;
    const duplicates = existing.slice(1);
    const firstNonEmpty = (...values: unknown[]) => {
      for (const value of values) {
        const next = normalize(value);
        if (next) return next;
      }
      return '';
    };

    const mergedTitle = firstNonEmpty(title, ...existing.map((row: any) => row?.title));
    const mergedIconUrl = firstNonEmpty(iconUrl, ...existing.map((row: any) => row?.icon_url));
    const mergedReason = firstNonEmpty(reason, ...existing.map((row: any) => row?.reason));
    const mergedLocalId = firstNonEmpty(localId, ...existing.map((row: any) => row?.local_id), url);

    if (screenshotResult.value) {
      uploaded = await uploadScreenshotToStorage(service, userId, screenshotResult.value);
      if (!uploaded) return NextResponse.json({ error: 'SCREENSHOT_UPLOAD_FAILED' }, { status: 500 });
    }

    const mergedScreenshotUrl = uploaded?.publicUrl || firstNonEmpty(incomingScreenshotUrl, ...existing.map((row: any) => row?.screenshot_url));
    const mergedScreenshotBlocked = mergedScreenshotUrl ? false : (screenshotBlocked || existing.some((row: any) => Boolean(row?.screenshot_blocked)));
    const duplicateIds = duplicates.map((row: any) => normalize(row?.id)).filter(Boolean);
    const nowIso = new Date().toISOString();

    const nooped = !uploaded && Boolean(keeper?.id) && duplicateIds.length === 0 &&
      normalize(keeper?.title) === mergedTitle &&
      normalize(keeper?.icon_url) === mergedIconUrl &&
      normalize(keeper?.screenshot_url) === mergedScreenshotUrl &&
      Boolean(keeper?.screenshot_blocked) === mergedScreenshotBlocked &&
      normalize(keeper?.reason) === mergedReason &&
      normalize(keeper?.local_id) === mergedLocalId;

    if (nooped) {
      return NextResponse.json({
        user_id: userId,
        memory: publicMemory(keeper),
        upserted: true,
        nooped: true,
        duplicatesCollapsed: 0,
        profileSync: access.profileSync
      });
    }

    let persisted: any = null;
    if (keeper?.id) {
      const updatePayload: Record<string, any> = {
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
      };
      if (uploaded?.path) updatePayload.screenshot_path = uploaded.path;

      const { data, error } = await service
        .from('personal_memories')
        .update(updatePayload)
        .eq('id', keeper.id)
        .eq('user_id', userId)
        .select(INTERNAL_MEMORY_SELECT)
        .single();
      if (error) {
        if (uploaded?.path) await removeScreenshotPaths(service, userId, [uploaded.path]);
        uploaded = null;
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      persisted = data;
    } else {
      const insertPayload: Record<string, any> = {
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
      };
      if (uploaded?.path) insertPayload.screenshot_path = uploaded.path;

      const { data, error } = await service
        .from('personal_memories')
        .insert(insertPayload)
        .select(INTERNAL_MEMORY_SELECT)
        .single();
      if (error) {
        if (uploaded?.path) await removeScreenshotPaths(service, userId, [uploaded.path]);
        uploaded = null;
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      persisted = data;
    }

    let collapsed = 0;
    let duplicateCleanupPaths: string[] = [];
    if (duplicateIds.length) {
      const { error: collapseError } = await service
        .from('personal_memories')
        .update({ deleted_at: nowIso, updated_at: nowIso })
        .in('id', duplicateIds)
        .eq('user_id', userId);
      if (collapseError) {
        console.error('Dock duplicate collapse failed', collapseError.message);
      } else {
        collapsed = duplicateIds.length;
        duplicateCleanupPaths = duplicates.map((row: any) => normalize(row?.screenshot_path)).filter(Boolean);
      }
    }

    const retiredPaths: string[] = [...duplicateCleanupPaths];
    const oldKeeperPath = normalize(keeper?.screenshot_path);
    const newPath = normalize(persisted?.screenshot_path);
    if (uploaded?.path && oldKeeperPath && oldKeeperPath !== newPath) retiredPaths.push(oldKeeperPath);
    if (retiredPaths.length) await removeScreenshotPaths(service, userId, retiredPaths);

    return NextResponse.json({
      user_id: userId,
      memory: publicMemory(persisted),
      upserted: true,
      duplicatesCollapsed: collapsed,
      profileSync: access.profileSync
    });
  } catch (error: any) {
    if (service && userId && uploaded?.path) await removeScreenshotPaths(service, userId, [uploaded.path]);
    console.error('Dock /api/user/memories POST exception', error?.message || error);
    return NextResponse.json({ error: error?.message || 'Unknown server error' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const authResult = await requireUser(request);
    if ('error' in authResult) return authResult.error;
    const service = getServiceSupabase();
    const userId = authResult.user.id;
    const access = await requireCurrentAccess(service, userId);
    if ('error' in access) return access.error;

    let body: any = {};
    try {
      const rawBody = await request.text();
      body = rawBody ? JSON.parse(rawBody) : {};
    } catch {}

    const search = request.nextUrl.searchParams;
    const first = (...values: unknown[]) => {
      for (const value of values) {
        const next = normalize(value);
        if (next) return next;
      }
      return '';
    };

    const memoryId = first(
      search.get('id'), search.get('memory_id'), search.get('memoryId'),
      request.headers.get('x-memory-id'), request.headers.get('x-dock-memory-id'),
      body?.id, body?.memory_id, body?.memoryId
    );
    const rawUrl = first(
      search.get('url'), request.headers.get('x-memory-url'), request.headers.get('x-dock-memory-url'),
      body?.url, body?.memory_url, body?.memoryUrl
    );
    const normalizedUrl = normalizeMemoryUrl(rawUrl);
    if (!memoryId && !rawUrl && !normalizedUrl) {
      return NextResponse.json({ error: 'Missing memory id or url' }, { status: 400 });
    }

    let targetRows: any[] = [];
    if (memoryId) {
      const { data, error } = await service
        .from('personal_memories')
        .select('id,url,screenshot_path')
        .eq('user_id', userId)
        .eq('id', memoryId)
        .limit(1);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      targetRows = data || [];
    } else {
      const { data, error } = await service
        .from('personal_memories')
        .select('id,url,screenshot_path')
        .eq('user_id', userId)
        .limit(5000);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      const rawLower = rawUrl.toLowerCase();
      const normalizedLower = normalizedUrl.toLowerCase();
      targetRows = (data || []).filter((row: any) => {
        const rowUrl = normalize(row?.url);
        const rowNormalized = normalizeMemoryUrl(rowUrl);
        return (!!rawLower && rowUrl.toLowerCase() === rawLower) || (!!normalizedLower && rowNormalized.toLowerCase() === normalizedLower);
      });
    }

    const targetIds = targetRows.map((row: any) => normalize(row?.id)).filter(Boolean);
    if (!targetIds.length) {
      return NextResponse.json({
        user_id: userId,
        ok: true,
        deletedCount: 0,
        deleted: [],
        requested: { id: memoryId || null, rawUrl, normalizedUrl },
        profileSync: access.profileSync
      });
    }

    const { data: deleted, error: deleteError } = await service
      .from('personal_memories')
      .delete()
      .eq('user_id', userId)
      .in('id', targetIds)
      .select('id,url');
    if (deleteError) return NextResponse.json({ error: deleteError.message }, { status: 500 });

    await removeScreenshotPaths(service, userId, targetRows.map((row: any) => row?.screenshot_path));

    return NextResponse.json({
      user_id: userId,
      ok: true,
      deletedCount: (deleted || []).length,
      deleted: deleted || [],
      requested: { id: memoryId || null, rawUrl, normalizedUrl },
      profileSync: access.profileSync
    });
  } catch (error: any) {
    console.error('Dock /api/user/memories DELETE exception', error?.message || error);
    return NextResponse.json({ error: error?.message || 'Unknown server error' }, { status: 500 });
  }
}
