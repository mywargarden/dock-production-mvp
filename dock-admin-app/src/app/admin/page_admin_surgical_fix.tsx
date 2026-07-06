'use client'

import { useEffect, useMemo, useState } from 'react'
import { getAccessToken, getUser, signIn, signOut } from '@/lib/auth'

type TabRow = { title: string; url: string; icon_url?: string; is_locked?: boolean }
type Organization = {
  id?: string
  name: string
  org_code: string
  email_domain: string
  plan: string
  max_users: number
  license_status?: string
  district_logo_url?: string
  district_background_url?: string
  district_accent_color?: string
}

const INITIAL_ORG: Organization = { name: '', org_code: '', email_domain: '', plan: 'district', max_users: 500, district_accent_color: '#8fd8c6' }
const INITIAL_TABS: TabRow[] = [{ title: 'Gmail', url: 'https://mail.google.com/', icon_url: '', is_locked: true }]

function normalizedUrl(value: string) {
  const raw = String(value || '').trim()
  if (!raw) return ''
  return /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
}

function normalizeImageUrl(value: string) {
  const raw = String(value || '').trim()
  if (!raw) return ''
  return raw.startsWith('data:image/') || /^https?:\/\//i.test(raw) ? raw : ''
}

async function imageFileToOptimizedDataUrl(file: File, maxSize = 512) {
  if (!file.type.startsWith('image/')) throw new Error('Please upload an image file.')
  if (file.size > 1024 * 1024 * 3) throw new Error('Image file is too large. Keep it under 3 MB.')

  const sourceDataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error('Could not read image file.'))
    reader.readAsDataURL(file)
  })

  return await new Promise<string>((resolve) => {
    const img = new Image()
    img.onload = () => {
      const scale = Math.min(1, maxSize / img.width, maxSize / img.height)
      const width = Math.max(1, Math.round(img.width * scale))
      const height = Math.max(1, Math.round(img.height * scale))
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')
      if (!ctx) return resolve(sourceDataUrl)
      ctx.clearRect(0, 0, width, height)
      ctx.drawImage(img, 0, 0, width, height)
      resolve(canvas.toDataURL('image/webp', 0.82) || sourceDataUrl)
    }
    img.onerror = () => resolve(sourceDataUrl)
    img.src = sourceDataUrl
  })
}

export default function AdminPage() {
  const [org, setOrg] = useState<Organization>(INITIAL_ORG)
  const [workspaceName, setWorkspaceName] = useState('District Dock')
  const [tabs, setTabs] = useState<TabRow[]>(INITIAL_TABS)
  const [user, setUser] = useState<any>(null)
  const [status, setStatus] = useState('')
  const [loading, setLoading] = useState(false)
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)
  const [lastSavedDraftAt, setLastSavedDraftAt] = useState<string | null>(null)
  const [lastPublishedAt, setLastPublishedAt] = useState<string | null>(null)
  const [liveVersion, setLiveVersion] = useState<number>(1)

  const liveApiUrl = useMemo(() => typeof window !== 'undefined' ? `${window.location.origin}/api/org/${encodeURIComponent(org.org_code || 'district')}/workspace` : '', [org.org_code])
  const districtPreviewUrl = useMemo(() => typeof window !== 'undefined' ? `${window.location.origin}/district/${encodeURIComponent(org.org_code || 'district')}` : '', [org.org_code])

  useEffect(() => {
    let active = true
    ;(async () => {
      const u = await getUser()
      if (!active) return
      setUser(u)
      if (u) await loadMySettings()
    })()
    return () => { active = false }
  }, [])

  function markDirty() { setHasUnsavedChanges(true) }

  function getCleanTabs() {
    return tabs.map((tab) => ({
      title: String(tab.title || '').trim(),
      url: normalizedUrl(tab.url),
      icon_url: normalizeImageUrl(tab.icon_url || ''),
      is_locked: true
    })).filter((tab) => tab.url)
  }

  function buildPayload() {
    return {
      organization: {
        name: org.name,
        org_code: org.org_code,
        email_domain: org.email_domain,
        plan: org.plan,
        max_users: org.max_users,
        district_logo_url: normalizeImageUrl(org.district_logo_url || ''),
        district_background_url: normalizeImageUrl(org.district_background_url || ''),
        district_accent_color: org.district_accent_color || '#8fd8c6'
      },
      workspaceName,
      tabs: getCleanTabs(),
      domains: [],
      admins: []
    }
  }

  async function loadMySettings() {
    try {
      const accessToken = await getAccessToken()
      if (!accessToken) throw new Error('Sign in again before loading district settings.')
      setLoading(true)
      setStatus('Loading your district workspace…')
      const response = await fetch('/api/admin/my-settings', { headers: { Authorization: `Bearer ${accessToken}` }, cache: 'no-store' })
      const result = await response.json()
      if (!response.ok) throw new Error(result?.error || 'Could not load district settings.')
      const organization = result.organization || {}
      const publishedWorkspace = result.publishedWorkspace || {}
      const nextTabs = Array.isArray(organization.draft_tabs) && organization.draft_tabs.length ? organization.draft_tabs : (Array.isArray(result.tabs) ? result.tabs : [])
      setOrg({
        id: organization.id,
        name: organization.name || '',
        org_code: organization.org_code || '',
        email_domain: organization.email_domain || '',
        plan: organization.plan || 'district',
        max_users: Number(organization.max_users) || 500,
        license_status: organization.license_status || 'active',
        district_logo_url: organization.district_logo_url || '',
        district_background_url: organization.district_background_url || '',
        district_accent_color: organization.district_accent_color || '#8fd8c6'
      })
      setWorkspaceName(organization.draft_workspace_name || publishedWorkspace.name || `${organization.name || 'District'} Dock`)
      setTabs((nextTabs.length ? nextTabs : INITIAL_TABS).map((tab: any) => ({
        title: tab.title || '',
        url: tab.url || '',
        icon_url: tab.icon_url || tab.customIcon || '',
        is_locked: true
      })))
      setLastPublishedAt(publishedWorkspace.published_at || null)
      setLiveVersion(Number(publishedWorkspace.version) || 1)
      setHasUnsavedChanges(false)
      setStatus('District workspace loaded.')
    } catch (error: any) {
      setStatus(error?.message || 'Could not load district workspace.')
    } finally {
      setLoading(false)
    }
  }

  async function saveDraft() {
    try {
      const accessToken = await getAccessToken()
      if (!accessToken) throw new Error('Sign in again before saving.')
      if (!getCleanTabs().length) throw new Error('Add at least one link before saving.')
      setLoading(true)
      setStatus('Saving draft…')
      const response = await fetch('/api/admin/save-draft', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` }, body: JSON.stringify(buildPayload()) })
      const result = await response.json()
      if (!response.ok) throw new Error(result?.error || 'Save draft failed.')
      setLastSavedDraftAt(result.savedAt || new Date().toISOString())
      setHasUnsavedChanges(false)
      setStatus('Draft saved.')
    } catch (error: any) {
      setStatus(error?.message || 'Draft save failed.')
    } finally {
      setLoading(false)
    }
  }

  async function publishWorkspace() {
    try {
      const accessToken = await getAccessToken()
      if (!accessToken) throw new Error('Sign in again before publishing.')
      if (!getCleanTabs().length) throw new Error('Add at least one link before publishing.')
      setLoading(true)
      setStatus('Publishing live workspace…')
      const response = await fetch('/api/admin/publish', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` }, body: JSON.stringify(buildPayload()) })
      const result = await response.json()
      if (!response.ok) throw new Error(result?.error || 'Publish failed.')
      setLastPublishedAt(result.publishedAt || new Date().toISOString())
      setLiveVersion(Number(result.version) || liveVersion + 1)
      setHasUnsavedChanges(false)
      setStatus(`Published live workspace v${Number(result.version) || liveVersion + 1}.`)
    } catch (error: any) {
      setStatus(error?.message || 'Publish failed.')
    } finally {
      setLoading(false)
    }
  }

  function updateTab(index: number, key: keyof TabRow, value: string | boolean) {
    setTabs((current) => current.map((tab, i) => i === index ? { ...tab, [key]: value } : tab))
    markDirty()
  }

  function addTab() { setTabs((current) => [...current, { title: '', url: '', icon_url: '', is_locked: true }]); markDirty() }
  function removeTab(index: number) { setTabs((current) => current.filter((_, i) => i !== index)); markDirty() }
  function moveTab(index: number, direction: -1 | 1) {
    setTabs((current) => {
      const next = [...current]
      const target = index + direction
      if (target < 0 || target >= next.length) return current
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })
    markDirty()
  }

  async function uploadTabImage(index: number, file?: File | null) {
    try {
      if (!file) return
      const dataUrl = await imageFileToOptimizedDataUrl(file, 512)
      updateTab(index, 'icon_url', dataUrl)
      setStatus('Link image uploaded. Save or publish when ready.')
    } catch (error: any) { setStatus(error?.message || 'Image upload failed.') }
  }

  async function uploadBrandImage(key: 'district_logo_url' | 'district_background_url', file?: File | null) {
    try {
      if (!file) return
      const dataUrl = await imageFileToOptimizedDataUrl(file, key === 'district_background_url' ? 1400 : 512)
      setOrg((current) => ({ ...current, [key]: dataUrl }))
      markDirty()
      setStatus(key === 'district_background_url' ? 'District Dock background uploaded.' : 'District logo uploaded.')
    } catch (error: any) { setStatus(error?.message || 'Image upload failed.') }
  }

  if (!user) {
    return <main><div className="card heroCard"><h1>District Admin</h1><p className="muted">Sign in with your approved school admin account.</p><button type="button" onClick={signIn}>Sign in</button></div></main>
  }

  return (
    <main>
      <div className="card heroCard">
        <div className="row wrap" style={{ justifyContent: 'space-between' }}>
          <div>
            <h1>District Admin</h1>
            <p className="muted">Manage the links and branding your staff see in their managed District Dock.</p>
            <p className="muted">Logged in as: {user.email}</p>
          </div>
          <div className="row wrap"><button type="button" className="secondary" onClick={loadMySettings} disabled={loading}>Reload</button><button type="button" className="secondary" onClick={signOut}>Logout</button></div>
        </div>
      </div>

      <div className="card statusCard">
        <div className="row wrap" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
          <h2>{org.name || 'District'} Dock Status</h2>
          <span className={`statusPill ${hasUnsavedChanges ? 'warn' : 'ok'}`}>{hasUnsavedChanges ? 'Unsaved Changes' : 'Saved'}</span>
        </div>
        <div className="statusGrid">
          <div className="statusBlock"><span className="statusLabel">Workspace</span><strong>{workspaceName}</strong></div>
          <div className="statusBlock"><span className="statusLabel">Live Version</span><strong>v{liveVersion}</strong></div>
          <div className="statusBlock"><span className="statusLabel">Last Draft Save</span><strong>{lastSavedDraftAt ? new Date(lastSavedDraftAt).toLocaleString() : '—'}</strong></div>
          <div className="statusBlock"><span className="statusLabel">Last Published</span><strong>{lastPublishedAt ? new Date(lastPublishedAt).toLocaleString() : '—'}</strong></div>
        </div>
      </div>

      <div className="card">
        <h2>District Info</h2>
        <p className="muted">Licenses, domains, seats, and admin access are managed by Dock HQ.</p>
        <div className="grid">
          <label>District<input value={org.name} readOnly /></label>
          <label>Primary Domain<input value={org.email_domain} readOnly /></label>
          <label>License<input value={`${org.license_status || 'active'} · ${org.max_users || 0} seats`} readOnly /></label>
          <label>Live JSON<input value={liveApiUrl} readOnly /></label>
          <label className="gridSpan2">District Workspace Page<div className="row wrap"><input style={{ flex: 1 }} value={districtPreviewUrl} readOnly /><a className="buttonLink secondaryLink" href={districtPreviewUrl} target="_blank" rel="noreferrer">Open Preview</a></div></label>
        </div>
      </div>

      <div className="card">
        <h2>District Dock Branding</h2>
        <div className="grid">
          <label className="gridSpan2">District Dock Name<input value={workspaceName} onChange={(e) => { setWorkspaceName(e.target.value); markDirty() }} /></label>
          <label>Accent Color<input type="color" value={org.district_accent_color || '#8fd8c6'} onChange={(e) => { setOrg((current) => ({ ...current, district_accent_color: e.target.value })); markDirty() }} /></label>
          <label>Upload District Logo<input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" onChange={(e) => uploadBrandImage('district_logo_url', e.target.files?.[0] || null)} /></label>
          <label className="gridSpan2">Upload District Dock Background<input type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => uploadBrandImage('district_background_url', e.target.files?.[0] || null)} /></label>
        </div>
        <div className="row wrap" style={{ marginTop: 14 }}>
          {org.district_logo_url ? <button type="button" className="secondary" onClick={() => { setOrg((c) => ({ ...c, district_logo_url: '' })); markDirty() }}>Clear Logo</button> : null}
          {org.district_background_url ? <button type="button" className="secondary" onClick={() => { setOrg((c) => ({ ...c, district_background_url: '' })); markDirty() }}>Clear Background</button> : null}
        </div>
      </div>

      <div className="card">
        <div className="row wrap" style={{ justifyContent: 'space-between', marginBottom: 12 }}><h2>Managed Links</h2><button type="button" onClick={addTab}>Add Link</button></div>
        {tabs.map((tab, index) => <div className="tabCard" key={index}>
          <div className="tabMainRow"><input value={tab.title} onChange={(e) => updateTab(index, 'title', e.target.value)} placeholder="Title" /><input value={tab.url} onChange={(e) => updateTab(index, 'url', e.target.value)} placeholder="https://example.com" /><div className="tabActions"><button type="button" className="secondary" onClick={() => moveTab(index, -1)}>↑</button><button type="button" className="secondary" onClick={() => moveTab(index, 1)}>↓</button><button type="button" className="secondary" onClick={() => removeTab(index)}>Remove</button></div></div>
          <div className="iconUploadRow"><div className="iconPreviewBox">{tab.icon_url ? <img src={tab.icon_url} alt="Link image preview" /> : <img src="/dock-placeholder.png" alt="Dock placeholder" />}</div><div className="iconControls"><div className="row wrap"><label style={{ display: 'inline-flex' }}><span className="buttonLink">Upload Image/Screenshot</span><input className="hiddenInput" type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml,image/gif" onChange={(e) => uploadTabImage(index, e.target.files?.[0] || null)} /></label><button type="button" className="secondary" onClick={() => updateTab(index, 'icon_url', '')}>Clear Image</button></div><div className="dropZone"><strong>Use a square icon or screenshot</strong><span>Uploaded images appear on the managed card.</span></div></div></div>
        </div>)}
      </div>

      <div className="card">
        <h2>Staff Preview</h2>
        <div className="previewShell" style={{ background: org.district_background_url ? `linear-gradient(rgba(248,251,255,.86), rgba(248,251,255,.86)), url(${org.district_background_url}) center/cover` : undefined }}>
          <div className="previewHeader"><strong>{workspaceName || 'District Dock'}</strong><span className="previewPill" style={{ background: org.district_accent_color || undefined }}>Managed</span></div>
          {org.district_logo_url ? <div style={{ marginBottom: 14 }}><img src={org.district_logo_url} alt="District logo preview" style={{ maxWidth: 160, maxHeight: 90, objectFit: 'contain' }} /></div> : null}
          <div className="previewGrid">{tabs.filter((t) => String(t.url || '').trim()).map((tab, index) => <div className="previewCard" key={`${tab.title}-${index}`}><div className="previewIcon">{tab.icon_url ? <img src={tab.icon_url} alt="Link preview" /> : <img src="/dock-placeholder.png" alt="Dock placeholder" />}</div><div className="previewText"><strong>{tab.title || 'Untitled'}</strong><span>{normalizedUrl(tab.url)}</span></div></div>)}</div>
        </div>
      </div>

      <div className="card actionBarCard"><div className="row wrap" style={{ justifyContent: 'space-between', alignItems: 'center' }}><div className="row wrap"><button type="button" className="secondary" onClick={saveDraft} disabled={loading}>{loading ? 'Working…' : 'Save Draft'}</button><button type="button" onClick={publishWorkspace} disabled={loading}>{loading ? 'Working…' : 'Publish Live'}</button></div><span className="status">{status}</span></div></div>
    </main>
  )
}
