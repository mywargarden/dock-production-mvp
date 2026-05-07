import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin, validatePayload } from '@/lib/adminServer'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const payload = validatePayload(body)
    const auth = await requireAdmin(request, payload.organization.org_code)

    if ('error' in auth) return auth.error

    const saveTime = new Date().toISOString()

    const { data: orgRow, error: orgError } = await auth.service
      .from('organizations')
      .upsert(
        {
          name: payload.organization.name,
          org_code: payload.organization.org_code,
          email_domain: payload.organization.email_domain,
          plan: payload.organization.plan,
          max_users: payload.organization.max_users,
          draft_workspace_name: payload.workspaceName,
          draft_tabs: payload.tabs,
          updated_at: saveTime
        },
        { onConflict: 'org_code' }
      )
      .select('*')
      .single()

    if (orgError) throw orgError

    return NextResponse.json({ ok: true, org: orgRow, savedAt: saveTime })
  } catch (error: any) {
    console.error('Dock admin save draft failed', error)
    return NextResponse.json({ error: error?.message || 'Draft save failed.' }, { status: 400 })
  }
}
