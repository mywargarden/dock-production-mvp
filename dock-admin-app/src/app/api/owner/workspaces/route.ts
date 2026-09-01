export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { normalize, requireOwner } from '@/lib/ownerServer'

export async function GET(request: NextRequest) {
  try {
    const auth = await requireOwner(request)
    if ('error' in auth) return auth.error

    const organizationId = normalize(request.nextUrl.searchParams.get('organizationId'))
    if (!organizationId) {
      return NextResponse.json({ error: 'organizationId is required.' }, { status: 400 })
    }

    const [{ data: org, error: orgError }, { data: live, error: liveError }, { data: versions, error: versionsError }] = await Promise.all([
      auth.service.from('organizations').select('id,name,org_code').eq('id', organizationId).maybeSingle(),
      auth.service.from('workspaces').select('id,name,version,status,published_at,updated_at').eq('organization_id', organizationId).eq('status', 'published').order('published_at', { ascending: false }).limit(1).maybeSingle(),
      auth.service.from('workspace_versions').select('id,organization_id,workspace_id,version,name,published_at,created_at,tabs,branding').eq('organization_id', organizationId).order('version', { ascending: false }).limit(100),
    ])

    if (orgError) throw orgError
    if (liveError) throw liveError
    if (versionsError) throw versionsError
    if (!org) return NextResponse.json({ error: 'District not found.' }, { status: 404 })

    return NextResponse.json({
      ok: true,
      district: org,
      live: live || null,
      versions: versions || [],
    })
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Could not load workspace recovery history.' }, { status: 400 })
  }
}
