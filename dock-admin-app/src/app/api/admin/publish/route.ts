import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin, validatePayload } from '@/lib/adminServer'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const payload = validatePayload(body)
    const auth = await requireAdmin(request, payload.organization.org_code)

    if ('error' in auth) return auth.error

    const publishTime = new Date().toISOString()

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
          published_at: publishTime,
          updated_at: publishTime
        },
        { onConflict: 'org_code' }
      )
      .select('*')
      .single()

    if (orgError) throw orgError

    const { data: existingPublished, error: existingError } = await auth.service
      .from('workspaces')
      .select('*')
      .eq('organization_id', orgRow.id)
      .eq('status', 'published')
      .order('published_at', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (existingError) throw existingError

    let workspaceId = existingPublished?.id as string | undefined
    const nextVersion = (Number(existingPublished?.version) || 0) + 1

    if (workspaceId) {
      const { error: updateError } = await auth.service
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

      if (updateError) throw updateError
    } else {
      const { data: insertedWorkspace, error: insertWorkspaceError } = await auth.service
        .from('workspaces')
        .insert({
          organization_id: orgRow.id,
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

    const { error: deleteError } = await auth.service
      .from('workspace_tabs')
      .delete()
      .eq('workspace_id', workspaceId)

    if (deleteError) throw deleteError

    const { error: insertTabsError } = await auth.service.from('workspace_tabs').insert(
      payload.tabs.map((tab, index) => ({
        workspace_id: workspaceId,
        title: tab.title || new URL(tab.url).hostname,
        url: tab.url,
        icon_url: tab.icon_url || null,
        position: index,
        is_locked: tab.is_locked !== false,
        updated_at: publishTime
      }))
    )

    if (insertTabsError) throw insertTabsError

    return NextResponse.json({
      ok: true,
      org: orgRow,
      workspaceId,
      version: nextVersion || 1,
      publishedAt: publishTime
    })
  } catch (error: any) {
    console.error('Dock admin publish failed', error)
    return NextResponse.json({ error: error?.message || 'Publish failed.' }, { status: 400 })
  }
}
