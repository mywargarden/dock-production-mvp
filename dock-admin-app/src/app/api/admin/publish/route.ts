export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { validatePayload } from '@/lib/adminServer'
import { requireActiveAdmin } from '@/lib/adminGuard'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const payload = validatePayload(body)
    const auth = await requireActiveAdmin(request, payload.organization.org_code)
    if ('error' in auth) return auth.error

    const { data: existingOrg, error: existingError } = await auth.service
      .from('organizations')
      .select('id,allow_admin_branding')
      .eq('org_code', payload.organization.org_code)
      .maybeSingle()
    if (existingError) throw existingError
    if (!existingOrg?.id) throw new Error('District organization was not found. Dock HQ must create the district before school admins can publish it.')

    const branding = existingOrg.allow_admin_branding === false ? {} : {
      district_logo_url: payload.organization.district_logo_url || null,
      district_background_url: payload.organization.district_background_url || null,
      district_accent_color: payload.organization.district_accent_color || null,
    }

    const { data: result, error: publishError } = await auth.service.rpc('dock_admin_publish_workspace', {
      p_organization_id: existingOrg.id,
      p_workspace_name: payload.workspaceName,
      p_tabs: payload.tabs,
      p_branding: branding,
      p_actor_user_id: auth.user.id,
    })
    if (publishError) throw publishError

    return NextResponse.json({ ok: true, ...(result || {}) })
  } catch (error: any) {
    console.error('Dock admin publish failed', error)
    return NextResponse.json({ error: error?.message || 'Publish failed.' }, { status: 400 })
  }
}
