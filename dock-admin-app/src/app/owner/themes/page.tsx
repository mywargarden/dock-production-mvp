'use client'

import { useEffect, useMemo, useState } from 'react'
import { getAccessToken, getUser, signIn } from '@/lib/auth'

const THEME_CATALOG = [
  ['dock-green', 'Dock Green', 'Calm default Dock palette'],
  ['slate', 'Slate', 'Cool neutral workspace'],
  ['warm', 'Warm', 'Soft warm neutral'],
  ['sunset', 'Sunset', 'Signature scenic theme'],
  ['violet-harbor', 'Violet Harbor', 'Soft violet workspace'],
  ['rubber-ducky', 'Rubber Ducky', 'Playful scenic theme'],
  ['crazy-ducky', 'Crazy Ducky', 'High-energy scenic theme'],
  ['tie-dye', 'Tie Dye', 'Colorful scenic theme'],
  ['skipper-harbor', 'Skipper Harbor', 'Premium coastal scene']
]

async function fileToDataUrl(file: File, maxSize = 1400) {
  if (!file.type.startsWith('image/')) throw new Error('Choose an image file.')
  if (file.size > 4 * 1024 * 1024) throw new Error('Keep images under 4 MB.')
  const raw = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error('Could not read image.'))
    reader.readAsDataURL(file)
  })
  return await new Promise<string>((resolve) => {
    const image = new Image()
    image.onload = () => {
      const scale = Math.min(1, maxSize / image.width, maxSize / image.height)
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(image.width * scale))
      canvas.height = Math.max(1, Math.round(image.height * scale))
      const ctx = canvas.getContext('2d')
      if (!ctx) return resolve(raw)
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height)
      resolve(canvas.toDataURL('image/webp', 0.84))
    }
    image.onerror = () => resolve(raw)
    image.src = raw
  })
}

export default function ThemeStudioPage() {
  const [user, setUser] = useState<any>(null)
  const [districts, setDistricts] = useState<any[]>([])
  const [orgCode, setOrgCode] = useState('')
  const [accent, setAccent] = useState('#8fd8c6')
  const [logo, setLogo] = useState('')
  const [background, setBackground] = useState('')
  const [status, setStatus] = useState('')
  const [saving, setSaving] = useState(false)

  const selected = useMemo(() => districts.find((d) => d.organization?.org_code === orgCode), [districts, orgCode])

  useEffect(() => {
    ;(async () => {
      const u = await getUser()
      setUser(u)
      if (u) await loadDistricts()
    })()
  }, [])

  useEffect(() => {
    const org = selected?.organization
    if (!org) return
    setAccent(org.district_accent_color || '#8fd8c6')
    setLogo(org.district_logo_url || '')
    setBackground(org.district_background_url || '')
  }, [selected])

  async function loadDistricts() {
    const token = await getAccessToken()
    if (!token) return
    const response = await fetch('/api/owner/districts', { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' })
    const result = await response.json()
    if (!response.ok) return setStatus(result?.error || 'Could not load districts.')
    const rows = result.districts || []
    setDistricts(rows)
    if (!orgCode && rows[0]?.organization?.org_code) setOrgCode(rows[0].organization.org_code)
  }

  async function saveBranding() {
    if (!selected) return setStatus('Choose a district first.')
    try {
      setSaving(true)
      setStatus('Saving theme and branding…')
      const token = await getAccessToken()
      if (!token) throw new Error('Sign in again.')
      const org = selected.organization
      const payload = {
        organization: {
          ...org,
          district_accent_color: accent,
          district_logo_url: logo,
          district_background_url: background,
          license_renewal_date: org.license_renewal_date || '',
          grace_period_days: org.grace_period_days ?? 30,
          minimum_extension_version: org.minimum_extension_version || '',
          owner_notes: org.owner_notes || ''
        },
        domains: selected.domains || [],
        admins: selected.admins || [],
        allowedUsers: selected.allowedUsers || []
      }
      const response = await fetch('/api/owner/districts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload)
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result?.error || 'Could not save branding.')
      setDistricts(result.districts || [])
      setStatus('District branding saved.')
    } catch (error: any) {
      setStatus(error?.message || 'Save failed.')
    } finally {
      setSaving(false)
    }
  }

  if (!user) {
    return <main className="publicShell"><section className="card publicHero"><div className="heroEyebrow">Dock HQ</div><h1>Theme Studio</h1><p className="muted publicLead">Owner access is required.</p><button onClick={signIn}>Sign in to Dock HQ</button></section></main>
  }

  return (
    <main className="publicShell themeStudioShell">
      <section className="card publicHero">
        <div className="heroEyebrow">Dock HQ · Owner Only</div>
        <h1>Theme Studio</h1>
        <p className="muted publicLead">Control district branding from the mothership. Theme catalog management and district visual identity live here—not in District Admin.</p>
        <div className="grid" style={{ marginTop: 20 }}>
          <label>District<select value={orgCode} onChange={(e) => setOrgCode(e.target.value)}>{districts.map((d) => <option key={d.organization.id} value={d.organization.org_code}>{d.organization.name}</option>)}</select></label>
          <label>Accent Color<input type="color" value={accent} onChange={(e) => setAccent(e.target.value)} /></label>
        </div>
      </section>

      <section className="card">
        <h2>District Brand Canvas</h2>
        <p className="muted">Logo, background art, and accent color are delivered with the district's managed Dock configuration.</p>
        <div className="themeBrandGrid">
          <div className="themePreview" style={{ background: background ? `linear-gradient(rgba(8,22,39,.3),rgba(8,22,39,.3)),url(${background}) center/cover` : accent }}>
            {logo ? <img src={logo} alt="District logo preview" /> : <div className="themePreviewMark">{String(selected?.organization?.name || 'D').slice(0, 2).toUpperCase()}</div>}
            <strong>{selected?.organization?.name || 'Choose a district'}</strong>
            <span>Managed Dock preview</span>
          </div>
          <div className="themeControls">
            <label>District Logo<input type="file" accept="image/*" onChange={async (e) => { const f = e.target.files?.[0]; if (f) setLogo(await fileToDataUrl(f, 600)) }} /></label>
            <label>Dock Background<input type="file" accept="image/*" onChange={async (e) => { const f = e.target.files?.[0]; if (f) setBackground(await fileToDataUrl(f, 1600)) }} /></label>
            <label>Logo URL / Data URL<input value={logo} onChange={(e) => setLogo(e.target.value)} placeholder="https://…" /></label>
            <label>Background URL / Data URL<input value={background} onChange={(e) => setBackground(e.target.value)} placeholder="https://…" /></label>
            <div className="row wrap"><button className="secondary" onClick={() => setLogo('')}>Clear Logo</button><button className="secondary" onClick={() => setBackground('')}>Clear Background</button><button onClick={saveBranding} disabled={saving}>{saving ? 'Saving…' : 'Save Branding'}</button></div>
            <p className="status">{status}</p>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="row wrap" style={{ justifyContent: 'space-between' }}><div><h2>Dock Theme Library</h2><p className="muted">The visual themes already shipped in Dock are inventoried here so HQ becomes the permanent control point.</p></div><span className="memoryBadge">{THEME_CATALOG.length} themes</span></div>
        <div className="themeCatalog">
          {THEME_CATALOG.map(([id, name, description]) => <div className="themeCatalogCard" key={id}><div className={`themeSwatch theme-${id}`}><span>{name.slice(0, 1)}</span></div><strong>{name}</strong><p>{description}</p><code>{id}</code></div>)}
        </div>
        <p className="muted" style={{ marginTop: 18 }}>Next step in this module: assign a default Dock theme per district and manage custom owner-created themes. I am keeping that separate from district branding until the managed-theme assignment is wired end-to-end.</p>
      </section>
    </main>
  )
}
