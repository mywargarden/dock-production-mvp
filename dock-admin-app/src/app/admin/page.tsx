'use client'

import { useEffect, useMemo, useState } from 'react'
import { getUser, signIn, signOut, getAccessToken } from '@/lib/auth'
import { supabase } from '@/lib/supabase'

type TabRow = {
  title: string
  url: string
  icon_url?: string
  is_locked?: boolean
}

type UserMemory = {
  id: string
  user_id: string
  title: string | null
  url: string
  icon_url: string | null
  created_at: string
  updated_at: string
}

type Organization = {
  id?: string
  name: string
  org_code: string
  email_domain: string
  plan: string
  max_users: number
  published_at?: string | null
  updated_at?: string | null
  draft_workspace_name?: string | null
}

const INITIAL_TABS: TabRow[] = [
  { title: 'Gmail', url: 'https://mail.google.com/' },
  { title: 'Canvas', url: 'https://henry.instructure.com/' },
  { title: 'PowerSchool', url: 'https://hcva.powerschool.com/teachers/pw.html' },
  { title: 'ParentSquare', url: 'https://www.parentsquare.com/' },
  { title: 'ClassLink', url: 'https://launchpad.classlink.com/' }
]

export default function Home() {
  const [org, setOrg] = useState<Organization>({
    name: 'Henry County Public Schools',
    org_code: 'henry-county',
    email_domain: 'henry.k12.va.us',
    plan: 'district',
    max_users: 500
  })

  const [workspaceName, setWorkspaceName] = useState('Henry County HCPS Dock')
  const [tabs, setTabs] = useState<TabRow[]>(INITIAL_TABS)
  const [status, setStatus] = useState('')
  const [user, setUser] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [lastPublishedAt, setLastPublishedAt] = useState<string | null>(null)
  const [lastSavedDraftAt, setLastSavedDraftAt] = useState<string | null>(null)
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)
  const [liveVersion, setLiveVersion] = useState<number>(1)
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  const [userMemories, setUserMemories] = useState<UserMemory[]>([])
  const [userMemoriesLoading, setUserMemoriesLoading] = useState(false)
  const [memoryForm, setMemoryForm] = useState({ title: '', url: '', icon_url: '' })

  const apiPreview = useMemo(
    () => `/api/org/${encodeURIComponent(org.org_code || 'district')}/workspace`,
    [org.org_code]
  )

  const liveApiUrl = useMemo(
    () =>
      `https://dock-production-mvp.vercel.app/api/org/${encodeURIComponent(
        org.org_code || 'district'
      )}/workspace`,
    [org.org_code]
  )

  const districtPreviewUrl = useMemo(
    () => `https://dock-production-mvp.vercel.app/district/${encodeURIComponent(org.org_code || 'district')}`,
    [org.org_code]
  )

  async function loadUserMemories(userId: string) {
    setUserMemoriesLoading(true)
    try {
      const accessToken = await getAccessToken()
      const res = await fetch('/api/user/memories', {
        headers: accessToken ? {
          Authorization: `Bearer ${accessToken}`
        } : {}
      })

      const data = await res.json()
      const memories = Array.isArray(data?.memories) ? data.memories : []
      setUserMemories(memories)
    } catch (error) {
      console.error('Failed to load user memories', error)
    } finally {
      setUserMemoriesLoading(false)
    }
  }

  useEffect(() => {
    let active = true

    async function loadUser() {
      const u = await getUser()

      if (!active) return

      setUser(u)
      setCurrentUserId(u?.id || null)

      if (u?.id) {
        await loadUserMemories(u.id)
      }
    }

    loadUser()

    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    let active = true

    async function loadExisting() {
      if (!org.org_code) return

      const { data: orgRow } = await supabase
        .from('organizations')
        .select('*')
        .eq('org_code', org.org_code)
        .maybeSingle()

      if (!active || !orgRow) return

      setOrg({
        id: orgRow.id,
        name: orgRow.name,
        org_code: orgRow.org_code,
        email_domain: orgRow.email_domain || '',
        plan: orgRow.plan || 'district',
        max_users: orgRow.max_users || 500,
        published_at: orgRow.published_at || null,
        updated_at: orgRow.updated_at || null,
        draft_workspace_name: orgRow.draft_workspace_name || null
      })

      setLastPublishedAt(orgRow.published_at || null)

      const draftTabs = Array.isArray(orgRow.draft_tabs) ? orgRow.draft_tabs : []

      if (orgRow.updated_at) setLastSavedDraftAt(orgRow.updated_at)
      if (orgRow.draft_workspace_name) {
        setWorkspaceName(orgRow.draft_workspace_name || 'HCPS Dock')
      }

      if (draftTabs.length) {
        setTabs(
          draftTabs.map((t: any) => ({
            title: t.title || '',
            url: t.url || '',
            icon_url: t.icon_url || '',
            is_locked: t.is_locked !== false
          }))
        )
        setHasUnsavedChanges(false)
        return
      }

      const { data: workspaceRow } = await supabase
        .from('workspaces')
        .select('*')
        .eq('organization_id', orgRow.id)
        .eq('status', 'published')
        .order('published_at', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (!active || !workspaceRow) return

      setWorkspaceName(workspaceRow.name || 'HCPS Dock')
      setLiveVersion(Number(workspaceRow.version) || 1)
      setLastPublishedAt(workspaceRow.published_at || null)

      const { data: tabRows } = await supabase
        .from('workspace_tabs')
        .select('*')
        .eq('workspace_id', workspaceRow.id)
        .order('position', { ascending: true })

      if (!active) return

      if (Array.isArray(tabRows) && tabRows.length) {
        setTabs(
          tabRows.map((t: any) => ({
            title: t.title,
            url: t.url,
            icon_url: t.icon_url || '',
            is_locked: t.is_locked !== false
          }))
        )
      }

      setHasUnsavedChanges(false)
    }

    loadExisting()

    return () => {
      active = false
    }
  }, [org.org_code])

  function normalizedUrl(value: string) {
    const raw = (value || '').trim()
    if (!raw) return ''
    return raw.startsWith('http://') || raw.startsWith('https://') ? raw : `https://${raw}`
  }

  function getCleanTabs() {
    return tabs
      .map((tab) => ({
        title: tab.title.trim(),
        url: normalizedUrl(tab.url),
        icon_url: (tab.icon_url || '').trim(),
        is_locked: tab.is_locked !== false
      }))
      .filter((tab) => tab.url)
  }

  function updateTab(index: number, key: keyof TabRow, value: string | boolean) {
    setTabs((current) =>
      current.map((tab, i) => (i === index ? { ...tab, [key]: value } : tab))
    )
    setHasUnsavedChanges(true)
  }

  function addTab() {
    setTabs((current) => [...current, { title: '', url: '', icon_url: '', is_locked: true }])
    setHasUnsavedChanges(true)
  }

  function removeTab(index: number) {
    setTabs((current) => current.filter((_, i) => i !== index))
    setHasUnsavedChanges(true)
  }

  function moveTab(index: number, direction: -1 | 1) {
    setTabs((current) => {
      const next = [...current]
      const target = index + direction
      if (target < 0 || target >= next.length) return current
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })
    setHasUnsavedChanges(true)
  }

  function triggerIconPick(index: number) {
    ;(document.getElementById(`icon-upload-${index}`) as HTMLInputElement | null)?.click()
  }

  function clearIcon(index: number) {
    setTabs((current) =>
      current.map((tab, i) => (i === index ? { ...tab, icon_url: '' } : tab))
    )
    setHasUnsavedChanges(true)
  }

  async function handleIconUpload(index: number, file?: File | null) {
    if (!file) return

    if (!file.type.startsWith('image/')) {
      setStatus('Please upload an image file for the icon.')
      return
    }

    if (file.size > 1024 * 1024 * 2) {
      setStatus('Icon file is too large. Keep it under 2 MB.')
      return
    }

    const sourceDataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result || ''))
      reader.onerror = () => reject(new Error('Could not read icon file.'))
      reader.readAsDataURL(file)
    })

    const optimizedDataUrl = await new Promise<string>((resolve) => {
      const img = new Image()
      img.onload = () => {
        const maxSize = 64
        const scale = Math.min(1, maxSize / img.width, maxSize / img.height)
        const width = Math.max(1, Math.round(img.width * scale))
        const height = Math.max(1, Math.round(img.height * scale))
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          resolve(sourceDataUrl)
          return
        }
        ctx.clearRect(0, 0, width, height)
        ctx.drawImage(img, 0, 0, width, height)
        resolve(canvas.toDataURL('image/webp', 0.82) || sourceDataUrl)
      }
      img.onerror = () => resolve(sourceDataUrl)
      img.src = sourceDataUrl
    })

    setTabs((current) =>
      current.map((tab, i) => (i === index ? { ...tab, icon_url: optimizedDataUrl } : tab))
    )
    setHasUnsavedChanges(true)
    setStatus('Icon uploaded. Save draft or publish live when ready.')
  }

  async function savePersonalMemory() {
    try {
      if (!currentUserId) {
        setStatus('Sign in to save personal memories.')
        return
      }

      const title = memoryForm.title.trim()
      const url = normalizedUrl(memoryForm.url)
      const icon_url = memoryForm.icon_url.trim()

      if (!url) {
        setStatus('Personal memory URL is required.')
        return
      }

      setLoading(true)
      const response = await fetch('/api/user/memories', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(await getAccessToken() ? { Authorization: `Bearer ${await getAccessToken()}` } : {})
        },
        body: JSON.stringify({ title, url, icon_url })
      })

      const result = await response.json()
      if (!response.ok) {
        throw new Error(result?.error || 'Failed to save personal memory.')
      }

      setMemoryForm({ title: '', url: '', icon_url: '' })
      await loadUserMemories(currentUserId)
      setStatus('Personal memory saved to your hosted library.')
    } catch (error: any) {
      setStatus(error?.message || 'Failed to save personal memory.')
    } finally {
      setLoading(false)
    }
  }

  async function deletePersonalMemory(memoryId: string) {
    try {
      if (!currentUserId) return
      setLoading(true)
      const response = await fetch(`/api/user/memories?id=${encodeURIComponent(memoryId)}`, {
        method: 'DELETE',
        headers: (await getAccessToken()) ? { Authorization: `Bearer ${await getAccessToken()}` } : {}
      })
      const result = await response.json()
      if (!response.ok) {
        throw new Error(result?.error || 'Failed to delete personal memory.')
      }
      await loadUserMemories(currentUserId)
      setStatus('Personal memory removed.')
    } catch (error: any) {
      setStatus(error?.message || 'Failed to delete personal memory.')
    } finally {
      setLoading(false)
    }
  }

  async function saveDraft() {
    try {
      setLoading(true)
      setStatus('Saving draft…')

      const cleanTabs = getCleanTabs()

      if (!org.org_code.trim()) throw new Error('Organization code is required.')
      if (!workspaceName.trim()) throw new Error('HCPS Dock name is required.')
      if (!cleanTabs.length) throw new Error('Add at least one tab before saving.')

      const accessToken = await getAccessToken()
      if (!accessToken) throw new Error('Sign in again before saving draft.')

      const response = await fetch('/api/admin/save-draft', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`
        },
        body: JSON.stringify({
          organization: {
            name: org.name.trim(),
            org_code: org.org_code.trim(),
            email_domain: org.email_domain.trim(),
            plan: org.plan,
            max_users: Number(org.max_users) || 500
          },
          workspaceName: workspaceName.trim(),
          tabs: cleanTabs
        })
      })

      const result = await response.json()
      if (!response.ok) throw new Error(result?.error || 'Draft save failed.')

      const orgRow = result.org
      const draftTime = result.savedAt || new Date().toISOString()

      setOrg((current) => ({
        ...current,
        id: orgRow.id,
        published_at: orgRow.published_at || null,
        updated_at: orgRow.updated_at || null,
        draft_workspace_name: orgRow.draft_workspace_name || null
      }))

      setLastSavedDraftAt(draftTime)
      setHasUnsavedChanges(false)
      setStatus(`Draft saved. Preview path ready at ${apiPreview}`)
    } catch (error: any) {
      setStatus(error?.message || 'Draft save failed.')
    } finally {
      setLoading(false)
    }
  }

  async function publishWorkspace() {
    try {
      setLoading(true)
      setStatus('Publishing workspace…')

      const cleanTabs = getCleanTabs()

      if (!org.org_code.trim()) throw new Error('Organization code is required.')
      if (!workspaceName.trim()) throw new Error('HCPS Dock name is required.')
      if (!cleanTabs.length) throw new Error('Add at least one tab before publishing.')

      const accessToken = await getAccessToken()
      if (!accessToken) throw new Error('Sign in again before publishing.')

      const response = await fetch('/api/admin/publish', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`
        },
        body: JSON.stringify({
          organization: {
            name: org.name.trim(),
            org_code: org.org_code.trim(),
            email_domain: org.email_domain.trim(),
            plan: org.plan,
            max_users: Number(org.max_users) || 500
          },
          workspaceName: workspaceName.trim(),
          tabs: cleanTabs
        })
      })

      const result = await response.json()
      if (!response.ok) throw new Error(result?.error || 'Publish failed.')

      const publishTime = result.publishedAt || new Date().toISOString()
      const nextVersion = Number(result.version) || 1
      const orgRow = result.org

      if (orgRow?.id) {
        setOrg((current) => ({
          ...current,
          id: orgRow.id,
          published_at: orgRow.published_at || publishTime,
          updated_at: orgRow.updated_at || publishTime,
          draft_workspace_name: orgRow.draft_workspace_name || null
        }))
      }

      setLastPublishedAt(publishTime)
      setLastSavedDraftAt(publishTime)
      setLiveVersion(nextVersion)
      setHasUnsavedChanges(false)
      setStatus(`Published live workspace v${nextVersion}. Live endpoint ready at ${liveApiUrl}`)
    } catch (error: any) {
      setStatus(error?.message || 'Publish failed.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main>
      <div className="card heroCard">
        <h1>Dock Admin</h1>
        <p className="muted">
          Manage a district workspace, save draft changes safely, and publish a stable Dock
          payload for every teacher.
        </p>

        {!user ? (
          <div className="row wrap" style={{ marginTop: 12 }}>
            <button type="button" onClick={signIn}>
              Sign in with email
            </button>
          </div>
        ) : (
          <div style={{ marginTop: 12 }}>
            <p style={{ fontSize: 12, color: '#667085' }}>Logged in as: {user.email}</p>
            <div className="row wrap" style={{ marginTop: 12 }}>
              <button type="button" className="secondary" onClick={signOut}>
                Logout
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="card statusCard">
        <div className="row wrap" style={{ justifyContent: 'space-between', marginBottom: 14 }}>
          <h2>HCPS Dock Status</h2>
          <span className={`statusPill ${hasUnsavedChanges ? 'warn' : 'ok'}`}>
            {hasUnsavedChanges ? 'Unsaved changes' : 'Draft saved'}
          </span>
        </div>

        <div className="statusGrid">
          <div className="statusBlock">
            <span className="statusLabel">Draft Status</span>
            <strong>{hasUnsavedChanges ? 'Unsaved changes' : 'Draft saved'}</strong>
          </div>
          <div className="statusBlock">
            <span className="statusLabel">Last Draft Save</span>
            <strong>
              {lastSavedDraftAt ? new Date(lastSavedDraftAt).toLocaleString() : 'Not saved yet'}
            </strong>
          </div>
          <div className="statusBlock">
            <span className="statusLabel">Last Published</span>
            <strong>
              {lastPublishedAt ? new Date(lastPublishedAt).toLocaleString() : 'Not published yet'}
            </strong>
          </div>
          <div className="statusBlock">
            <span className="statusLabel">Live Version</span>
            <strong>v{liveVersion}</strong>
          </div>
        </div>
      </div>

      <div className="card">
        <h2>Organization</h2>
        <div className="grid">
          <label>
            Organization Name
            <input
              value={org.name}
              onChange={(e) => {
                setOrg((current) => ({ ...current, name: e.target.value }))
                setHasUnsavedChanges(true)
              }}
            />
          </label>

          <label>
            Organization Code
            <input
              value={org.org_code}
              onChange={(e) => {
                setOrg((current) => ({ ...current, org_code: e.target.value }))
                setHasUnsavedChanges(true)
              }}
            />
          </label>

          <label>
            Email Domain
            <input
              value={org.email_domain}
              onChange={(e) => {
                setOrg((current) => ({ ...current, email_domain: e.target.value }))
                setHasUnsavedChanges(true)
              }}
            />
          </label>

          <label>
            Plan
            <select
              value={org.plan}
              onChange={(e) => {
                setOrg((current) => ({ ...current, plan: e.target.value }))
                setHasUnsavedChanges(true)
              }}
            >
              <option value="district">District</option>
              <option value="pro">Pro</option>
              <option value="free">Free</option>
            </select>
          </label>

          <label>
            Max Users
            <input
              type="number"
              value={org.max_users}
              onChange={(e) => {
                setOrg((current) => ({
                  ...current,
                  max_users: Number(e.target.value) || 500
                }))
                setHasUnsavedChanges(true)
              }}
            />
          </label>

          <label>
            Preview URL
            <input value={apiPreview} readOnly />
          </label>

          <label className="gridSpan2">
            District Workspace Page
            <div className="row wrap">
              <input style={{ flex: 1 }} value={districtPreviewUrl} readOnly />
              <a className="buttonLink secondaryLink" href={districtPreviewUrl} target="_blank" rel="noreferrer">
                Open Preview
              </a>
            </div>
          </label>

          <label className="gridSpan2">
            Live URL
            <input value={liveApiUrl} readOnly />
          </label>
        </div>
      </div>

      <div className="card">
        <h2>Draft HCPS Dock</h2>
        <div className="grid">
          <label className="gridSpan2">
            HCPS Dock Name
            <input
              value={workspaceName}
              onChange={(e) => {
                setWorkspaceName(e.target.value)
                setHasUnsavedChanges(true)
              }}
            />
          </label>
        </div>
      </div>

      <div className="card">
        <div className="row wrap" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
          <h2>Tabs</h2>
          <button type="button" onClick={addTab}>
            Add Tab
          </button>
        </div>

        {tabs.map((tab, index) => (
          <div className="tabCard" key={index}>
            <div className="tabMainRow">
              <input
                value={tab.title}
                onChange={(e) => updateTab(index, 'title', e.target.value)}
                placeholder="Title"
              />
              <input
                value={tab.url}
                onChange={(e) => updateTab(index, 'url', e.target.value)}
                placeholder="https://example.com"
              />
              <div className="tabActions">
                <button type="button" className="secondary" onClick={() => moveTab(index, -1)}>
                  ↑
                </button>
                <button type="button" className="secondary" onClick={() => moveTab(index, 1)}>
                  ↓
                </button>
                <button type="button" className="secondary" onClick={() => removeTab(index)}>
                  Remove
                </button>
              </div>
            </div>

            <div className="iconUploadRow">
              <div className="iconPreviewBox">
                {tab.icon_url ? (
                  <img src={tab.icon_url} alt={`${tab.title || 'Tab'} icon preview`} />
                ) : (
                  <img src="/dock-placeholder.png" alt="Dock placeholder" />
                )}
              </div>

              <div
                className="iconControls"
                onDragOver={(e) => {
                  e.preventDefault()
                  e.dataTransfer.dropEffect = 'copy'
                }}
                onDrop={(e) => {
                  e.preventDefault()
                  handleIconUpload(index, e.dataTransfer.files?.[0])
                }}
              >
                <div className="row wrap">
                  <button type="button" onClick={() => triggerIconPick(index)}>
                    Upload Icon
                  </button>
                  <button type="button" className="secondary" onClick={() => clearIcon(index)}>
                    Clear Icon
                  </button>
                </div>

                <input
                  id={`icon-upload-${index}`}
                  className="hiddenInput"
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/svg+xml,image/gif"
                  onChange={(e) => handleIconUpload(index, e.target.files?.[0] || null)}
                />

                <div className="dropZone">
                  <strong>Drag &amp; drop icon here</strong>
                  <span>or click Upload Icon</span>
                </div>

                <div className="helpText">
                  Use a square PNG when possible. 256×256 or 512×512 works best. Uploaded icons
                  stay crisp in full and compact views.
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="card">
        <div className="row wrap" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
          <h2>Teacher Preview</h2>
          <span className="muted">What teachers will see after publish</span>
        </div>

        <div className="previewShell">
          <div className="previewHeader">
            <strong>{workspaceName || 'HCPS Dock'}</strong>
            <span className="previewPill">Managed</span>
          </div>

          <div className="previewGrid">
            {tabs
              .filter((tab) => (tab.url || '').trim())
              .map((tab, index) => (
                <div className="previewCard" key={`${tab.title}-${index}`}>
                  <div className="previewIcon">
                    {tab.icon_url ? (
                      <img src={tab.icon_url} alt={`${tab.title || 'Tab'} icon`} />
                    ) : (
                      <img src="/dock-placeholder.png" alt="Dock placeholder" />
                    )}
                  </div>
                  <div className="previewText">
                    <strong>{tab.title || 'Untitled'}</strong>
                    <span>{normalizedUrl(tab.url)}</span>
                  </div>
                </div>
              ))}
          </div>
        </div>
      </div>

      <div className="card actionBarCard">
        <div
          className="row wrap"
          style={{ justifyContent: 'space-between', alignItems: 'center' }}
        >
          <div className="row wrap">
            <button type="button" className="secondary" onClick={saveDraft} disabled={loading}>
              {loading ? 'Working…' : 'Save Draft'}
            </button>
            <button type="button" onClick={publishWorkspace} disabled={loading}>
              {loading ? 'Working…' : 'Publish Live'}
            </button>
          </div>
          <span className="status">{status}</span>
        </div>
      </div>
    </main>
  )
}
