import Link from 'next/link'
import { createClient } from '@supabase/supabase-js'

type DistrictPageProps = {
  params: {
    orgCode: string
  }
}

type WorkspacePayload = {
  type?: string
  version?: number
  organization?: {
    id?: string
    name?: string
    orgCode?: string
    emailDomain?: string
  }
  workspace?: {
    id?: string
    name?: string
    version?: number
    publishedAt?: string
    updatedAt?: string
    tabs?: Array<{
      title?: string
      url?: string
      iconUrl?: string
      faviconUrl?: string
      isLocked?: boolean
    }>
  }
  license?: {
    plan?: string
    label?: string
    maxUsers?: number
  }
  error?: string
}

function getSiteOrigin() {
  return (
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.VERCEL_URL && `https://${process.env.VERCEL_URL}` ||
    'https://dock-production-mvp.vercel.app'
  )
}

async function getWorkspace(orgCode: string): Promise<WorkspacePayload> {
  const origin = getSiteOrigin()

  try {
    const response = await fetch(`${origin}/api/org/${encodeURIComponent(orgCode)}/workspace`, {
      cache: 'no-store'
    })

    const data = await response.json().catch(() => ({}))
    if (!response.ok) {
      return { error: data?.error || `Workspace request failed with status ${response.status}` }
    }

    return data as WorkspacePayload
  } catch (error: any) {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

    if (!supabaseUrl || !supabaseKey) {
      return { error: error?.message || 'Workspace could not be loaded.' }
    }

    const supabase = createClient(supabaseUrl, supabaseKey, {
      auth: { persistSession: false, autoRefreshToken: false }
    })

    const { data: org, error: orgError } = await supabase
      .from('organizations')
      .select('id, name, org_code, email_domain, plan, max_users')
      .eq('org_code', orgCode)
      .maybeSingle()

    if (orgError || !org) {
      return { error: orgError?.message || 'Organization not found.' }
    }

    const { data: workspace, error: workspaceError } = await supabase
      .from('workspaces')
      .select('id, name, version, published_at, updated_at')
      .eq('organization_id', org.id)
      .eq('status', 'published')
      .order('published_at', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (workspaceError || !workspace) {
      return { error: workspaceError?.message || 'No published workspace found.' }
    }

    const { data: tabs, error: tabsError } = await supabase
      .from('workspace_tabs')
      .select('title, url, icon_url, position, is_locked')
      .eq('workspace_id', workspace.id)
      .order('position', { ascending: true })

    if (tabsError) {
      return { error: tabsError.message }
    }

    return {
      type: 'dock-managed-config',
      version: Number(workspace.version) || 1,
      organization: {
        id: org.id,
        name: org.name,
        orgCode: org.org_code,
        emailDomain: org.email_domain || undefined
      },
      license: {
        plan: org.plan || 'district',
        label: org.plan || 'District',
        maxUsers: Number(org.max_users) || 500
      },
      workspace: {
        id: workspace.id,
        name: workspace.name,
        version: Number(workspace.version) || 1,
        publishedAt: workspace.published_at,
        updatedAt: workspace.updated_at,
        tabs: (tabs || []).map((tab: any) => ({
          title: tab.title,
          url: tab.url,
          iconUrl: tab.icon_url || '',
          faviconUrl: '',
          isLocked: tab.is_locked !== false
        }))
      }
    }
  }
}

export default async function DistrictWorkspacePage({ params }: DistrictPageProps) {
  const payload = await getWorkspace(params.orgCode)
  const orgName = payload.organization?.name || params.orgCode
  const workspaceName = payload.workspace?.name || 'Managed Dock Workspace'
  const tabs = payload.workspace?.tabs || []

  return (
    <main className="publicShell">
      <section className="card publicHero">
        <div className="heroEyebrow">District Workspace</div>
        <h1>{orgName}</h1>
        <p className="muted publicLead">
          {payload.error
            ? payload.error
            : `${workspaceName} is the published Safe Harbor workspace for this organization.`}
        </p>
        <div className="row wrap publicActions">
          <Link className="buttonLink" href="/admin">Open Admin</Link>
          <Link className="buttonLink secondaryLink" href={`/api/org/${encodeURIComponent(params.orgCode)}/workspace`}>View JSON Config</Link>
          <Link className="buttonLink secondaryLink" href="/">Dock Home</Link>
        </div>
      </section>

      {!payload.error && (
        <section className="card">
          <div className="previewHeader">
            <div>
              <h2>{workspaceName}</h2>
              <p className="muted">
                Version {payload.workspace?.version || payload.version || 1}
                {payload.workspace?.publishedAt ? ` · Published ${new Date(payload.workspace.publishedAt).toLocaleString()}` : ''}
              </p>
            </div>
            <span className="previewPill">{payload.license?.label || 'District'}</span>
          </div>

          {tabs.length ? (
            <div className="previewGrid districtPreviewGrid">
              {tabs.map((tab, index) => (
                <a className="previewCard districtPreviewCard" key={`${tab.url}-${index}`} href={tab.url || '#'} target="_blank" rel="noreferrer">
                  <div className="previewIcon">
                    {tab.iconUrl ? <img src={tab.iconUrl} alt="" /> : <span>{(tab.title || 'D').slice(0, 1)}</span>}
                  </div>
                  <div className="previewText">
                    <strong>{tab.title || tab.url}</strong>
                    <span>{tab.url}</span>
                    {tab.isLocked !== false && <span>Locked district resource</span>}
                  </div>
                </a>
              ))}
            </div>
          ) : (
            <p className="muted">No tabs have been published for this workspace yet.</p>
          )}
        </section>
      )}
    </main>
  )
}
