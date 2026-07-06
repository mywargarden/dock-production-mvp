export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { loadOrganizationSettings, requireAdmin } from '@/lib/adminServer'

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAdmin(request)
    if ('error' in auth) return auth.error

    const orgId = String(auth.profile?.organization_id || '').trim()
    if (!orgId) {
      return NextResponse.json({ error: 'No district organization is assigned to this admin profile.' }, { status: 403 })
    }

    const { data: org, error: orgError } = await auth.service
      .from('organizations')
      .select('org_code')
      .eq('id', orgId)
      .maybeSingle()

    if (orgError) throw orgError
    if (!org?.org_code) return NextResponse.json({ error: 'Assigned district was not found.' }, { status: 404 })

    const settings = await loadOrganizationSettings(auth.service, org.org_code)
    if (!settings) return NextResponse.json({ error: 'Organization not found.' }, { status: 404 })

    return NextResponse.json(settings, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error: any) {
    console.error('Dock admin my-settings failed', error)
    return NextResponse.json({ error: error?.message || 'Could not load admin settings.' }, { status: 400 })
  }
}
