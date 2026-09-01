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

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ orgCode: string }> }
) {
  try {
    const { orgCode: rawOrgCode } = await params
    const orgCode = decodeURIComponent(rawOrgCode || '').trim()
    if (!orgCode) return NextResponse.json({ error: 'Missing organization code.' }, { status: 400 })

    const auth = await requireActiveAdmin(request, orgCode)
    if ('error' in auth) return auth.error

    const settings = await loadOrganizationSettings(auth.service, orgCode)
    if (!settings) return NextResponse.json({ error: 'Organization not found.' }, { status: 404 })

    return NextResponse.json(withDraftBranding(settings), {
      headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' }
    })
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Could not load organization settings.' }, { status: 500 })
  }
}
