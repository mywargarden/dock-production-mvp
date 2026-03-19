import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

function getServerSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url) throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL');
  if (!service && !anon) throw new Error('Missing Supabase key');
  return createClient(url, service || anon!, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
}

export async function GET(_: Request, { params }: { params: { orgCode: string } }) {
  try {
    const supabase = getServerSupabase();
    const orgCode = decodeURIComponent(params.orgCode || '').trim();
    if (!orgCode) {
      return NextResponse.json({ error: 'Missing org code' }, { status: 400 });
    }

    const { data: org, error: orgError } = await supabase
      .from('organizations')
      .select('id,name,org_code,email_domain,plan,max_users,published_at')
      .eq('org_code', orgCode)
      .maybeSingle();

    if (orgError) {
      return NextResponse.json({ error: orgError.message }, { status: 500 });
    }
    if (!org) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
    }
    if (!org.published_at) {
      return NextResponse.json({ error: 'No published workspace yet' }, { status: 404 });
    }

    const { data: workspace, error: wsError } = await supabase
      .from('workspaces')
      .select('id,name,org_code,email_domain,plan,max_users,published_at')
      .eq('organization_id', org.id)
      .order('updated_at', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (wsError) {
      return NextResponse.json({ error: wsError.message }, { status: 500 });
    }
    if (!workspace) {
      return NextResponse.json({ error: 'Workspace not found' }, { status: 404 });
    }

    const { data: tabs, error: tabsError } = await supabase
      .from('workspace_tabs')
      .select('id, title, url, icon_url, position, created_at, is_locked')
      .eq('workspace_id', workspace.id)
      .order('position', { ascending: true })
      .order('created_at', { ascending: true });

    if (tabsError) {
      return NextResponse.json({ error: tabsError.message }, { status: 500 });
    }

    const normalizedTabs = (tabs || [])
      .map((tab: any) => ({
        title: String(tab?.title || '').trim() || 'Untitled',
        url: String(tab?.url || '').trim(),
        customIcon: String(tab?.icon_url || '').trim(),
        faviconUrl: ''
      }))
      .filter((tab) => /^https?:\/\//i.test(tab.url));

    return NextResponse.json({
      version: 1,
      type: 'dock-managed-config',
      organization: {
        id: org.id,
        name: org.name,
        orgCode: org.org_code,
        emailDomain: org.email_domain || ''
      },
      license: {
        plan: org.plan || 'district',
        label: (org.plan || 'district').charAt(0).toUpperCase() + (org.plan || 'district').slice(1),
        maxUsers: org.max_users || 500
      },
      workspace: {
        name: workspace.name,
        updatedAt: Date.now(),
        tabs: normalizedTabs
      },
      debug: {
        workspaceId: workspace.id,
        tabCount: normalizedTabs.length
      }
    }, {
      headers: {
        'Cache-Control': 'no-store, max-age=0',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': '*'
      }
    });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Unknown server error' }, { status: 500 });
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
