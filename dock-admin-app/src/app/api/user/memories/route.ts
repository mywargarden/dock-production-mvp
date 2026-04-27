import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

function getServerSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url) throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL');
  if (!serviceRoleKey) throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY');

  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
}

function sanitizeText(value: unknown, max = 500) {
  return String(value || '').trim().slice(0, max);
}

function sanitizeLongText(value: unknown, max = 2_000_000) {
  return String(value || '').trim().slice(0, max);
}

export async function GET(request: NextRequest) {
  try {
    const supabase = getServerSupabase();
    const userId = request.headers.get('x-user-id');

    if (!userId) {
      return NextResponse.json({ error: 'Missing x-user-id header' }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('personal_memories')
      .select('*')
      .eq('user_id', userId)
      .order('updated_at', { ascending: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ memories: data || [] });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || 'Unknown server error' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = getServerSupabase();
    const userId = request.headers.get('x-user-id');

    if (!userId) {
      return NextResponse.json({ error: 'Missing x-user-id header' }, { status: 400 });
    }

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
          updated_at: new Date().toISOString()
        })
        .eq('id', existing.id)
        .eq('user_id', userId)
        .select('*')
        .single();

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      return NextResponse.json({ memory: data, upserted: true });
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

    return NextResponse.json({ memory: data, upserted: false });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || 'Unknown server error' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const supabase = getServerSupabase();
    const userId = request.headers.get('x-user-id');

    if (!userId) {
      return NextResponse.json({ error: 'Missing x-user-id header' }, { status: 400 });
    }

    const memoryId = request.nextUrl.searchParams.get('id');

    if (!memoryId) {
      return NextResponse.json({ error: 'Missing memory id' }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('personal_memories')
      .delete()
      .eq('id', memoryId)
      .eq('user_id', userId)
      .select('*')
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ deleted: data || null, ok: true });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || 'Unknown server error' },
      { status: 500 }
    );
  }
}
