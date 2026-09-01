export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { loadOrganizationSettings } from '@/lib/adminServer'
import { requireActiveAdmin } from '@/lib/adminGuard'

function withDraftBranding(settings: any) {
  const organization = settings?.organization || {}
  const draft = organization?.draft_branding && typeof organization.draft_branding === 'object'
    ? organization.draft_branding
    : {}
  return {
    ...settings,
    organization: {
      ...organization,
      district_logo_url: Object.prototype.hasOwnProperty.call(draft, 'district_logo_url') ? draft.district_logo_url : organization.district_logo_url,
      district_background_url: Object.prototype.hasOwnProperty.call(draft, 'district_background_url') ? draft.district_background_url : organization.district_background_url,
      district_accent_color: Object.prototype.hasOwnProperty.call(draft, 'district_accent_color') ? draft.district_accent_color : organization.district_accent_color,
    }
  }
}

export async function GET(request: NextRequest) {
  try {
    const auth = await requireActiveAdmin(request)
    if ('error' in auth) return auth.error

    const orgId = String(auth.profile?.organization_id || '').trim()
    if (!orgId) return NextResponse.json({ error: 'No district organization is assigned to this admin profile.' }, { status: 403 })

    const { data: org, error: orgError } = await auth.service
      .from('organizations')
      .select('org_code')
      .eq('id', orgId)
      .maybeSingle()

    if (orgError) throw orgError
    if (!org?.org_code) return NextResponse.json({ error: 'Assigned district was not found.' }, { status: 404 })

    const settings = await loadOrganizationSettings(auth.service, org.org_code)
    if (!settings) return NextResponse.json({ error: 'Organization not found.' }, { status: 404 })

    return NextResponse.json(withDraftBranding(settings), { headers: { 'Cache-Control': 'no-store' } })
  } catch (error: any) {
    console.error('Dock admin my-settings failed', error)
    return NextResponse.json({ error: error?.message || 'Could not load admin settings.' }, { status: 400 })
  }
}
