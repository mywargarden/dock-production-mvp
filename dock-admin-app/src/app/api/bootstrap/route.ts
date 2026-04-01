import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

function getServerSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url) throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL');
  if (!serviceRoleKey && !anonKey) throw new Error('Missing Supabase key');

  return createClient(url, serviceRoleKey || anonKey!, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
}

function sanitizeValue(value: unknown) {
  return String(value || '').trim().toLowerCase();
}

export async function GET(request: NextRequest) {
  try {
    const supabase = getServerSupabase();
    const domain = sanitizeValue(request.nextUrl.searchParams.get('domain'));
    const orgCode = sanitizeValue(request.nextUrl.searchParams.get('orgCode'));

    if (!domain && !orgCode) {
      return NextResponse.json({ error: 'Missing domain or orgCode' }, { status: 400 });
    }

    let query = supabase
      .from('organizations')
      .select('id, name, org_code, email_domain, plan, max_users, created_at');

    if (orgCode) {
      query = query.eq('org_code', orgCode).limit(1);
    } else {
      query = query
        .eq('email_domain', domain)
        .order('created_at', { ascending: false })
        .limit(1);
    }

    const { data: orgRows, error } = await query;

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const org = Array.isArray(orgRows) ? orgRows[0] : null;

    if (!org) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
    }

    const origin = request.nextUrl.origin;
    const workspacePath = `/api/org/${encodeURIComponent(org.org_code)}/workspace`;

    return NextResponse.json(
      {
        organization: {
          id: org.id,
          name: org.name,
          orgCode: org.org_code,
          emailDomain: org.email_domain || ''
        },
        license: {
          plan: org.plan || 'district',
          maxUsers: Number(org.max_users) || 500
        },
        workspacePath,
        configUrl: `${origin}${workspacePath}`,
        apiBaseUrl: origin,
        syncMode: orgCode ? 'org-code' : 'email-domain'
      },
      {
        headers: {
          'Cache-Control': 'no-store, max-age=0',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, OPTIONS',
          'Access-Control-Allow-Headers': '*'
        }
      }
    );
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || 'Unknown server error' },
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
