import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

function getServiceSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url) throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL');
  if (!serviceRoleKey) throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY');

  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
}

function getAuthSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url) throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL');
  if (!anonKey) throw new Error('Missing NEXT_PUBLIC_SUPABASE_ANON_KEY');

  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
}

async function requireUser(request: NextRequest) {
  const authHeader =
    request.headers.get('authorization') ||
    request.headers.get('Authorization') ||
    '';

  const token = authHeader.replace(/^Bearer\s+/i, '').trim();

  if (!token) {
    return {
      error: NextResponse.json({ error: 'Missing bearer token' }, { status: 401 })
    };
  }

  const auth = getAuthSupabase();
  const { data, error } = await auth.auth.getUser(token);

  if (error || !data?.user?.id) {
    return {
      error: NextResponse.json({ error: 'Invalid auth token' }, { status: 401 })
    };
  }

  return { user: data.user };
}

function sanitizeText(value: unknown, max = 500) {
  return String(value || '').trim().slice(0, max);
}

function sanitizeLongText(value: unknown, max = 2_000_000) {
  return String(value || '').trim().slice(0, max);
}

export async function GET(request: NextRequest) {
  try {
    const authResult = await requireUser(request);
    if ('error' in authResult) return authResult.error;

    const supabase = getServiceSupabase();
    const userId = authResult.user.id;

    const { data, error } = await supabase
      .from('personal_memories')
      .select('*')
      .eq('user_id', userId)
      .is('deleted_at', null)
      .order('updated_at', { ascending: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      user_id: userId,
      memories: data || []
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || 'Unknown server error' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const authResult = await requireUser(request);
    if ('error' in authResult) return authResult.error;

    const supabase = getServiceSupabase();
    const userId = authResult.user.id;
    const body = await request.json();

    const title = sanitizeText(body?.title, 120);
    const url = sanitizeText(body?.url, 2000);
    const icon_url = sanitizeLongText(body?.icon_url, 500000);
    const screenshot_data_url = sanitizeLongText(body?.screenshot_data_url, 2_000_000);
    const screenshot_blocked = Boolean(body?.screenshot_blocked);
    const reason = sanitizeText(body?.reason, 500);
    const local_id = sanitizeText(body?.local_id, 120);

    if (!url) {
      return NextResponse.json({ error: 'URL is required' }, { status: 400 });
    }

    const { data: existing, error: existingError } = await supabase
      .from('personal_memories')
      .select('*')
      .eq('user_id', userId)
      .eq('url', url)
      .is('deleted_at', null)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existingError) {
      return NextResponse.json({ error: existingError.message }, { status: 500 });
    }

    if (existing?.id) {
      const { data, error } = await supabase
        .from('personal_memories')
        .update({
          title,
          icon_url: icon_url || null,
          screenshot_data_url: screenshot_data_url || null,
          screenshot_blocked,
          reason: reason || null,
          local_id: local_id || existing.local_id || null,
          deleted_at: null,
          updated_at: new Date().toISOString()
        })
        .eq('id', existing.id)
        .eq('user_id', userId)
        .select('*')
        .single();

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      return NextResponse.json({ user_id: userId, memory: data, upserted: true });
    }

    const { data, error } = await supabase
      .from('personal_memories')
      .insert({
        user_id: userId,
        title,
        url,
        icon_url: icon_url || null,
        screenshot_data_url: screenshot_data_url || null,
        screenshot_blocked,
        reason: reason || null,
        local_id: local_id || null
      })
      .select('*')
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ user_id: userId, memory: data, upserted: false });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || 'Unknown server error' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {


    const requestUrl = new URL(request.url);

// SHARE MODE (no auth)
if (requestUrl.searchParams.get('share') === '1') {
  const body = await request.json();
  const payload = body?.payload || body;

  if (!payload) {
    return NextResponse.json({ error: 'Missing share payload' }, { status: 400 });
  }

  const supabase = getServiceSupabase();
  const id = crypto.randomUUID().replace(/-/g, '').slice(0, 10);

  const { error } = await supabase
    .from('dock_shares')
    .insert({
      id,
      payload,
      created_by: null,
      extension_id: null,
      expires_at: null
    });

  if (error) {
    return NextResponse.json(
      { error: error.message, stage: 'share-insert' },
      { status: 500 }
    );
  }

  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    'https://dock-production-mvp.vercel.app';

  return NextResponse.json({
    success: true,
    id,
    url: `${appUrl}/s/${id}`
  });
}
    const authResult = await requireUser(request);
    if ('error' in authResult) return authResult.error;

    const supabase = getServiceSupabase();
    const userId = authResult.user.id;

    const memoryId = request.nextUrl.searchParams.get('id');
    const memoryUrl = request.nextUrl.searchParams.get('url');

    if (!memoryId && !memoryUrl) {
      return NextResponse.json({ error: 'Missing memory id or url' }, { status: 400 });
    }

    let query = supabase
      .from('personal_memories')
      .update({
        deleted_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('user_id', userId)
      .select('*');

    if (memoryId) query = query.eq('id', memoryId);
    if (memoryUrl) query = query.eq('url', memoryUrl);

    const { data, error } = await query;

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ user_id: userId, deleted: data || null, ok: true });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || 'Unknown server error' },
      { status: 500 }
    );
  }
}
