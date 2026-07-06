export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin, validatePayload } from '@/lib/adminServer'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const payload = validatePayload(body)
    const auth = await requireAdmin(request, payload.organization.org_code)
    if ('error' in auth) return auth.error

    const publishTime = new Date().toISOString()
    const { data: existingOrg, error: existingError } = await auth.service
      .from('organizations')
      .select('*')
      .eq('org_code', payload.organization.org_code)
      .maybeSingle()

    if (existingError) throw existingError
    if (!existingOrg?.id) throw new Error('District organization was not found. Dock HQ must create the district before school admins can publish it.')

    const { data: orgRow, error: updateOrgError } = await auth.service
      .from('organizations')
      .update({
        draft_workspace_name: payload.workspaceName,
        draft_tabs: payload.tabs,
        district_logo_url: payload.organization.district_logo_url || null,
        district_background_url: payload.organization.district_background_url || null,
        district_accent_color: payload.organization.district_accent_color || null,
        published_at: publishTime,
        updated_at: publishTime
      })
      .eq('id', existingOrg.id)
      .select('*')
      .single()

    if (updateOrgError) throw updateOrgError

    const { data: existingPublished, error: existingWorkspaceError } = await auth.service
      .from('workspaces')
      .select('*')
      .eq('organization_id', existingOrg.id)
      .eq('status', 'published')
      .order('published_at', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (existingWorkspaceError) throw existingWorkspaceError

    let workspaceId = existingPublished?.id as string | undefined
    const nextVersion = (Number(existingPublished?.version) || 0) + 1

    if (workspaceId) {
      try {
        await auth.service.from('workspace_versions').insert({
          organization_id: existingOrg.id,
          workspace_id: workspaceId,
          version: Number(existingPublished.version) || 1,
          name: existingPublished.name,
          tabs: existingOrg.draft_tabs || [],
          branding: {
            district_logo_url: existingOrg.district_logo_url || null,
            district_background_url: existingOrg.district_background_url || null,
            district_accent_color: existingOrg.district_accent_color || null
          },
          published_at: existingPublished.published_at || publishTime,
          created_by: auth.user.id
        }).throwOnError()
      } catch (versionError) {
        console.warn('Workspace version snapshot skipped. Apply owner_portal_licensing_branding.sql to enable rollback history.', versionError)
      }

      const { error: updateWorkspaceError } = await auth.service
        .from('workspaces')
        .update({
          name: payload.workspaceName,
          status: 'published',
          version: nextVersion,
          is_locked: true,
          updated_at: publishTime,
          published_at: publishTime
        })
        .eq('id', workspaceId)

      if (updateWorkspaceError) throw updateWorkspaceError
    } else {
      const { data: insertedWorkspace, error: insertWorkspaceError } = await auth.service
        .from('workspaces')
        .insert({
          organization_id: existingOrg.id,
          name: payload.workspaceName,
          status: 'published',
          version: 1,
          is_locked: true,
          updated_at: publishTime,
          published_at: publishTime
        })
        .select('*')
        .single()

      if (insertWorkspaceError) throw insertWorkspaceError
      workspaceId = insertedWorkspace.id
    }

    if (!workspaceId) throw new Error('Could not resolve published workspace.')

    await auth.service.from('workspace_tabs').delete().eq('workspace_id', workspaceId).throwOnError()
    await auth.service.from('workspace_tabs').insert(payload.tabs.map((tab, index) => ({
      workspace_id: workspaceId,
      title: tab.title || new URL(tab.url).hostname,
      url: tab.url,
      icon_url: tab.icon_url || null,
      position: index,
      is_locked: true,
      updated_at: publishTime
    }))).throwOnError()

    await auth.service.from('audit_logs').insert({
      organization_id: existingOrg.id,
      actor_user_id: auth.user.id,
      action: 'district_admin_publish',
      target_type: 'workspace',
      target_id: workspaceId,
      details: { workspaceName: payload.workspaceName, version: nextVersion, tabCount: payload.tabs.length }
    }).throwOnError()

    return NextResponse.json({ ok: true, org: orgRow, workspaceId, version: nextVersion || 1, publishedAt: publishTime })
  } catch (error: any) {
    console.error('Dock admin publish failed', error)
    return NextResponse.json({ error: error?.message || 'Publish failed.' }, { status: 400 })
  }
}
