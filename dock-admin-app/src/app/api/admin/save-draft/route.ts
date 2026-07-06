export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin, validatePayload } from '@/lib/adminServer'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const payload = validatePayload(body)
    const auth = await requireAdmin(request, payload.organization.org_code)
    if ('error' in auth) return auth.error

    const saveTime = new Date().toISOString()
    const { data: existingOrg, error: existingError } = await auth.service
      .from('organizations')
      .select('*')
      .eq('org_code', payload.organization.org_code)
      .maybeSingle()

    if (existingError) throw existingError
    if (!existingOrg?.id) throw new Error('District organization was not found. Dock HQ must create the district before school admins can edit it.')

    const { data: orgRow, error: updateError } = await auth.service
      .from('organizations')
      .update({
        draft_workspace_name: payload.workspaceName,
        draft_tabs: payload.tabs,
        district_logo_url: payload.organization.district_logo_url || null,
        district_background_url: payload.organization.district_background_url || null,
        district_accent_color: payload.organization.district_accent_color || null,
        updated_at: saveTime
      })
      .eq('id', existingOrg.id)
      .select('*')
      .single()

    if (updateError) throw updateError

    await auth.service.from('audit_logs').insert({
      organization_id: existingOrg.id,
      actor_user_id: auth.user.id,
      action: 'district_admin_save_draft',
      target_type: 'organization',
      target_id: existingOrg.id,
      details: { workspaceName: payload.workspaceName, tabCount: payload.tabs.length }
    }).throwOnError()

    return NextResponse.json({ ok: true, org: orgRow, savedAt: saveTime })
  } catch (error: any) {
    console.error('Dock admin save draft failed', error)
    return NextResponse.json({ error: error?.message || 'Draft save failed.' }, { status: 400 })
  }
}
