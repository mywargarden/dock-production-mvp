'use client'

import { useEffect, useMemo, useState } from 'react'
import { getAccessToken, getUser, signIn, signOut } from '@/lib/auth'

type View = 'overview' | 'districts' | 'users' | 'branding' | 'operations'
type DomainRow = { domain: string; status: 'verified' | 'pending'; domain_type: 'primary' | 'additional' }
type AdminRow = { email: string; role: 'owner' | 'district_admin' }
type AllowedUserRow = { email: string; name?: string; note?: string; status: 'active' | 'inactive' }
type DistrictForm = {
  organization: {
    id?: string
    name: string
    org_code: string
    email_domain: string
    plan: string
    max_users: number
    license_status: 'trial' | 'active' | 'past_due' | 'suspended' | 'expired'
    license_renewal_date: string
    grace_period_days: number
    minimum_extension_version: string
    owner_notes: string
    district_logo_url: string
    district_background_url: string
    district_accent_color: string
    default_theme: string
  }
  domains: DomainRow[]
  admins: AdminRow[]
  allowedUsers: AllowedUserRow[]
}

const THEMES = [
  ['dock-green', 'Dock Green'], ['slate', 'Slate'], ['warm', 'Warm'], ['sunset', 'Sunset'],
  ['violet-harbor', 'Violet Harbor'], ['rubber-ducky', 'Rubber Ducky'], ['crazy-ducky', 'Crazy Ducky'],
  ['tie-dye', 'Tie Dye'], ['skipper-harbor', 'Skipper Harbor']
]

const blankDistrict: DistrictForm = {
  organization: {
    name: '', org_code: '', email_domain: '', plan: 'district', max_users: 500,
    license_status: 'trial', license_renewal_date: '', grace_period_days: 30,
    minimum_extension_version: '', owner_notes: '', district_logo_url: '',
    district_background_url: '', district_accent_color: '#8fd8c6', default_theme: 'dock-green'
  },
  domains: [], admins: [], allowedUsers: []
}

function slugify(value: string) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}
function normalizeDomain(value: string) { return String(value || '').trim().toLowerCase().replace(/^@+/, '') }
function inputDate(value: string | null | undefined) {
  if (!value) return ''
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10)
}
function toForm(item: any): DistrictForm {
  const org = item?.organization || {}
  return {
    organization: {
      id: org.id || undefined,
      name: org.name || '', org_code: org.org_code || '', email_domain: org.email_domain || '',
      plan: org.plan || 'district', max_users: Number(org.max_users) || 500,
      license_status: org.license_status || 'trial', license_renewal_date: inputDate(org.license_renewal_date),
      grace_period_days: Number(org.grace_period_days) || 30, minimum_extension_version: org.minimum_extension_version || '',
      owner_notes: org.owner_notes || '', district_logo_url: org.district_logo_url || '',
      district_background_url: org.district_background_url || '', district_accent_color: org.district_accent_color || '#8fd8c6',
      default_theme: org.default_theme || 'dock-green'
    },
    domains: (item?.domains || []).map((d: any) => ({ domain: d.domain || d.normalized_domain || '', status: d.status === 'pending' ? 'pending' : 'verified', domain_type: d.domain_type === 'primary' ? 'primary' : 'additional' })),
    admins: (item?.admins || []).map((a: any) => ({ email: a.email || '', role: a.role === 'owner' ? 'owner' : 'district_admin' })),
    allowedUsers: (item?.allowedUsers || []).map((u: any) => ({ email: u.email || '', name: u.name || '', note: u.note || '', status: u.status === 'inactive' ? 'inactive' : 'active' }))
  }
}

async function imageToDataUrl(file: File, maxSize: number) {
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

export default function OwnerPage() {
  const [user, setUser] = useState<any>(null)
  const [districts, setDistricts] = useState<any[]>([])
  const [form, setForm] = useState<DistrictForm>(blankDistrict)
  const [view, setView] = useState<View>('overview')
  const [status, setStatus] = useState('Dock HQ ready.')
  const [loading, setLoading] = useState(false)
  const [dirty, setDirty] = useState(false)

  const selected = useMemo(() => districts.find((d) => d.organization?.org_code === form.organization.org_code), [districts, form.organization.org_code])
  const totalSeats = useMemo(() => districts.reduce((sum, d) => sum + (Number(d.organization?.max_users) || 0), 0), [districts])
  const seatsUsed = useMemo(() => districts.reduce((sum, d) => sum + (Number(d.activeSeatCount) || 0), 0), [districts])
  const attention = useMemo(() => districts.filter((d) => ['past_due', 'suspended', 'expired'].includes(d.organization?.license_status)).length, [districts])
  const activeCount = useMemo(() => districts.filter((d) => d.organization?.license_status === 'active').length, [districts])

  useEffect(() => {
    ;(async () => {
      const u = await getUser()
      setUser(u)
      if (u) await loadDistricts()
    })()
  }, [])

  async function loadDistricts() {
    try {
      setLoading(true)
      const token = await getAccessToken()
      if (!token) throw new Error('Sign in to Dock HQ first.')
      const response = await fetch('/api/owner/districts', { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' })
      const result = await response.json()
      if (!response.ok) throw new Error(result?.error || 'Could not load districts.')
      const rows = result.districts || []
      setDistricts(rows)
      setStatus(`Loaded ${rows.length} district${rows.length === 1 ? '' : 's'}.`)
      if (!form.organization.org_code && rows[0]) setForm(toForm(rows[0]))
    } catch (error: any) {
      setStatus(error?.message || 'Could not load Dock HQ.')
    } finally { setLoading(false) }
  }

  async function saveDistrict() {
    try {
      setLoading(true)
      setStatus('Saving owner changes…')
      const token = await getAccessToken()
      if (!token) throw new Error('Sign in again.')
      const response = await fetch('/api/owner/districts', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(form)
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result?.error || 'Could not save district.')
      const rows = result.districts || []
      setDistricts(rows)
      const current = rows.find((d: any) => d.organization?.org_code === result.organization?.org_code)
      if (current) setForm(toForm(current))
      setDirty(false)
      setStatus(`Saved ${result.organization?.name || 'district'}.`)
    } catch (error: any) { setStatus(error?.message || 'Save failed.') }
    finally { setLoading(false) }
  }

  async function toggleUser(userRow: any) {
    if (!selected?.organization?.id || !userRow?.id) return
    try {
      setLoading(true)
      const token = await getAccessToken()
      if (!token) throw new Error('Sign in again.')
      const nextStatus = userRow.status === 'inactive' ? 'active' : 'inactive'
      const response = await fetch('/api/owner/users', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ organizationId: selected.organization.id, userId: userRow.id, status: nextStatus })
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result?.error || 'Could not update user.')
      setDistricts(result.districts || [])
      setStatus(`${userRow.email || 'User'} set to ${nextStatus}.`)
    } catch (error: any) { setStatus(error?.message || 'Could not update user.') }
    finally { setLoading(false) }
  }

  function updateOrg(key: keyof DistrictForm['organization'], value: any) {
    setForm((current) => ({ ...current, organization: { ...current.organization, [key]: value } }))
    setDirty(true)
  }
  function chooseDistrict(d: any, nextView: View = 'districts') { setForm(toForm(d)); setView(nextView); setDirty(false) }
  function newDistrict() { setForm(blankDistrict); setView('districts'); setDirty(true); setStatus('New district ready.') }
  function addDomain() { setForm((c) => ({ ...c, domains: [...c.domains, { domain: '', status: 'verified', domain_type: 'additional' }] })); setDirty(true) }
  function addAdmin() { setForm((c) => ({ ...c, admins: [...c.admins, { email: '', role: 'district_admin' }] })); setDirty(true) }
  function addAllowed() { setForm((c) => ({ ...c, allowedUsers: [...c.allowedUsers, { email: '', name: '', note: '', status: 'active' }] })); setDirty(true) }

  if (!user) return (
    <main className="hq2SignIn">
      <section className="hq2SignInCard">
        <div className="hq2Logo">D</div>
        <div className="hq2Eyebrow" style={{ color: '#9cc8ff', marginTop: 20 }}>Owner Control Plane</div>
        <h1>Dock HQ</h1>
        <p>This is the private owner console. District admins and normal Dock users do not manage the business from here.</p>
        <button onClick={signIn}>Enter Dock HQ</button>
      </section>
    </main>
  )

  return (
    <div className="hq2Shell">
      <header className="hq2Top">
        <div className="hq2TopInner">
          <div className="hq2Brand"><div className="hq2Logo">D</div><div><strong>Dock HQ</strong><span>Owner console · {user.email}</span></div></div>
          <div className="hq2TopActions"><button onClick={loadDistricts}>{loading ? 'Working…' : 'Refresh'}</button><button onClick={signOut}>Sign out</button><button onClick={newDistrict}>+ New District</button></div>
        </div>
      </header>

      <div className="hq2App">
        <aside className="hq2Nav">
          <div className="hq2NavLabel">Owner workspace</div>
          {(['overview','districts','users','branding','operations'] as View[]).map((item) => <button key={item} className={view === item ? 'active' : ''} onClick={() => setView(item)}>{item === 'overview' ? 'Overview' : item === 'districts' ? 'Districts & Licensing' : item === 'users' ? 'Users & Seats' : item === 'branding' ? 'Theme Studio' : 'Operations'}</button>)}
          <div className="hq2NavDivider" /><div className="hq2NavNote">Owner-only work stays here. District Admin remains a separate customer-facing workspace editor.</div>
        </aside>

        <main className="hq2Content">
          <section className="hq2Hero">
            <div><div className="hq2Eyebrow">Dock Mothership</div><h1>{view === 'overview' ? 'Everything owner-side in one place.' : view === 'districts' ? 'Districts & licensing' : view === 'users' ? 'Users & seats' : view === 'branding' ? 'Theme Studio' : 'Operations'}</h1><p>{view === 'overview' ? 'Manage customers, licenses, seats, branding, access, releases, and system health without bouncing between owner sites.' : `Selected district: ${form.organization.name || 'none'}`}</p></div>
            <span className="hq2Badge">Owner authenticated</span>
          </section>

          {view === 'overview' && <>
            <section className="hq2Metrics">
              <div className="hq2Metric"><span>Districts</span><strong>{districts.length}</strong><small>customer organizations</small></div>
              <div className="hq2Metric"><span>Licensed seats</span><strong>{totalSeats.toLocaleString()}</strong><small>{seatsUsed.toLocaleString()} in use</small></div>
              <div className="hq2Metric"><span>Active licenses</span><strong>{activeCount}</strong><small>{districts.length - activeCount} trial or other</small></div>
              <div className="hq2Metric"><span>Needs attention</span><strong>{attention}</strong><small>past due, suspended, expired</small></div>
            </section>
            <div className="hq2Grid2">
              <section className="hq2Card"><div className="hq2CardHeader"><div><h2>Customer portfolio</h2><p>Every district from one directory.</p></div><button className="hq2Primary" onClick={newDistrict}>New district</button></div>
                <table className="hq2Table"><thead><tr><th>District</th><th>License</th><th>Seats</th><th>Workspace</th><th></th></tr></thead><tbody>{districts.map((d) => <tr key={d.organization.id}><td><div className="hq2DistrictName">{d.organization.name}</div><div className="hq2Sub">{d.organization.org_code} · {d.organization.email_domain || 'no domain'}</div></td><td><span className={`hq2Status ${d.organization.license_status || 'trial'}`}>{d.organization.license_status || 'trial'}</span></td><td>{d.activeSeatCount || 0} / {d.organization.max_users || 0}</td><td>v{d.publishedWorkspace?.version || '—'}</td><td><button className="hq2Ghost" onClick={() => chooseDistrict(d, 'districts')}>Manage</button></td></tr>)}</tbody></table>
              </section>
              <section className="hq2Card"><h2>Owner status</h2><div className="hq2Ops" style={{ marginTop: 14 }}><div className="hq2Op"><strong>Licensing</strong><span>Database controls active</span></div><div className="hq2Op"><strong>Seat tracking</strong><span>{seatsUsed} active profiles</span></div><div className="hq2Op"><strong>Branding</strong><span>Managed per district</span></div><div className="hq2Op"><strong>Billing</strong><span>Stripe automation still to finish</span></div></div><div className="hq2Notice">No raw API pages belong in the owner workflow. They stay behind the scenes.</div></section>
            </div>
          </>}

          {view === 'districts' && <>
            <section className="hq2Card"><div className="hq2CardHeader"><div><h2>District directory</h2><p>Select a customer to manage its owner-level settings.</p></div><button className="hq2Primary" onClick={newDistrict}>+ New District</button></div>
              <table className="hq2Table"><thead><tr><th>District</th><th>Status</th><th>Seats</th><th>Domain</th><th></th></tr></thead><tbody>{districts.map((d) => <tr key={d.organization.id}><td><div className="hq2DistrictName">{d.organization.name}</div><div className="hq2Sub">{d.organization.org_code}</div></td><td><span className={`hq2Status ${d.organization.license_status || 'trial'}`}>{d.organization.license_status || 'trial'}</span></td><td>{d.activeSeatCount || 0}/{d.organization.max_users || 0}</td><td>{d.organization.email_domain || '—'}</td><td><button className="hq2Ghost" onClick={() => chooseDistrict(d)}>Edit</button></td></tr>)}</tbody></table>
            </section>
            <section className="hq2Card"><div className="hq2CardHeader"><div><h2>{form.organization.name || 'New district'}</h2><p>License, access, domains, and owner notes.</p></div>{selected?.organization?.org_code ? <a className="hq2Ghost" href={`/district/${selected.organization.org_code}`} target="_blank" rel="noreferrer">Preview workspace</a> : null}</div>
              <div className="hq2FormGrid">
                <div className="hq2Field"><label>District name</label><input value={form.organization.name} onChange={(e) => { updateOrg('name', e.target.value); if (!form.organization.org_code) updateOrg('org_code', slugify(e.target.value)) }} /></div>
                <div className="hq2Field"><label>Org code</label><input value={form.organization.org_code} onChange={(e) => updateOrg('org_code', slugify(e.target.value))} /></div>
                <div className="hq2Field"><label>Primary email domain</label><input value={form.organization.email_domain} onChange={(e) => updateOrg('email_domain', normalizeDomain(e.target.value))} /></div>
                <div className="hq2Field"><label>Plan</label><select value={form.organization.plan} onChange={(e) => updateOrg('plan', e.target.value)}><option value="district">District</option><option value="pilot">Pilot</option><option value="school">School</option></select></div>
                <div className="hq2Field"><label>Licensed seats</label><input type="number" value={form.organization.max_users} onChange={(e) => updateOrg('max_users', Math.max(1, Number(e.target.value) || 1))} /></div>
                <div className="hq2Field"><label>License status</label><select value={form.organization.license_status} onChange={(e) => updateOrg('license_status', e.target.value)}><option value="trial">Trial</option><option value="active">Active</option><option value="past_due">Past Due</option><option value="suspended">Suspended</option><option value="expired">Expired</option></select></div>
                <div className="hq2Field"><label>Renewal date</label><input type="date" value={form.organization.license_renewal_date} onChange={(e) => updateOrg('license_renewal_date', e.target.value)} /></div>
                <div className="hq2Field"><label>Grace days</label><input type="number" value={form.organization.grace_period_days} onChange={(e) => updateOrg('grace_period_days', Number(e.target.value) || 0)} /></div>
                <div className="hq2Field"><label>Minimum extension version</label><input value={form.organization.minimum_extension_version} onChange={(e) => updateOrg('minimum_extension_version', e.target.value)} placeholder="0.2.3" /></div>
                <div className="hq2Field full"><label>Owner notes</label><textarea value={form.organization.owner_notes} onChange={(e) => updateOrg('owner_notes', e.target.value)} placeholder="Billing, renewal, support, or customer notes" /></div>
              </div>

              <h3 className="hq2SectionTitle">Verified domains</h3><div className="hq2MiniRows">{form.domains.length ? form.domains.map((entry,index) => <div className="hq2MiniRow" key={index}><input value={entry.domain} onChange={(e) => { const next=[...form.domains]; next[index]={...next[index],domain:normalizeDomain(e.target.value)}; setForm({...form,domains:next}); setDirty(true) }} /><select value={entry.status} onChange={(e) => { const next=[...form.domains]; next[index]={...next[index],status:e.target.value as any}; setForm({...form,domains:next}); setDirty(true) }}><option value="verified">Verified</option><option value="pending">Pending</option></select><button className="hq2Danger" onClick={() => { setForm({...form,domains:form.domains.filter((_,i)=>i!==index)}); setDirty(true) }}>Remove</button></div>) : <div className="hq2Empty">No verified domains yet.</div>}</div><button className="hq2Ghost" style={{ marginTop: 10 }} onClick={addDomain}>Add domain</button>

              <h3 className="hq2SectionTitle">District admins</h3><div className="hq2MiniRows">{form.admins.length ? form.admins.map((entry,index) => <div className="hq2MiniRow admin" key={index}><input value={entry.email} onChange={(e) => { const next=[...form.admins]; next[index]={...next[index],email:e.target.value}; setForm({...form,admins:next}); setDirty(true) }} /><select value={entry.role} onChange={(e) => { const next=[...form.admins]; next[index]={...next[index],role:e.target.value as any}; setForm({...form,admins:next}); setDirty(true) }}><option value="district_admin">District Admin</option><option value="owner">District Owner</option></select><button className="hq2Danger" onClick={() => { setForm({...form,admins:form.admins.filter((_,i)=>i!==index)}); setDirty(true) }}>Remove</button></div>) : <div className="hq2Empty">No district admins assigned.</div>}</div><button className="hq2Ghost" style={{ marginTop: 10 }} onClick={addAdmin}>Add admin</button>

              <h3 className="hq2SectionTitle">Outside-domain users</h3><div className="hq2MiniRows">{form.allowedUsers.length ? form.allowedUsers.map((entry,index) => <div className="hq2MiniRow allowed" key={index}><input value={entry.email} placeholder="email" onChange={(e) => { const next=[...form.allowedUsers]; next[index]={...next[index],email:e.target.value}; setForm({...form,allowedUsers:next}); setDirty(true) }} /><input value={entry.name || ''} placeholder="name" onChange={(e) => { const next=[...form.allowedUsers]; next[index]={...next[index],name:e.target.value}; setForm({...form,allowedUsers:next}); setDirty(true) }} /><input value={entry.note || ''} placeholder="note" onChange={(e) => { const next=[...form.allowedUsers]; next[index]={...next[index],note:e.target.value}; setForm({...form,allowedUsers:next}); setDirty(true) }} /><button className="hq2Danger" onClick={() => { setForm({...form,allowedUsers:form.allowedUsers.filter((_,i)=>i!==index)}); setDirty(true) }}>Remove</button></div>) : <div className="hq2Empty">No outside-domain exceptions.</div>}</div><button className="hq2Ghost" style={{ marginTop: 10 }} onClick={addAllowed}>Add user</button>
            </section>
          </>}

          {view === 'users' && <section className="hq2Card"><div className="hq2CardHeader"><div><h2>Users & seats</h2><p>Activate or deactivate profiles without leaving HQ.</p></div><select value={form.organization.org_code} onChange={(e) => { const d=districts.find((x)=>x.organization.org_code===e.target.value); if(d) chooseDistrict(d,'users') }}>{districts.map((d)=><option key={d.organization.id} value={d.organization.org_code}>{d.organization.name}</option>)}</select></div>
            <div className="hq2UserList">{selected?.users?.length ? selected.users.map((u:any)=><div className="hq2User" key={u.id}><div className="hq2UserMain"><strong>{u.email || 'Unnamed user'}</strong><div className="hq2Sub">{u.role || 'member'} · last seen {u.last_seen_at ? new Date(u.last_seen_at).toLocaleString() : 'unknown'}</div></div><div className="hq2Inline"><span className={`hq2Status ${u.status === 'inactive' ? 'expired' : 'active'}`}>{u.status || 'active'}</span><button className={u.status === 'inactive' ? 'hq2Primary' : 'hq2Danger'} onClick={()=>toggleUser(u)}>{u.status === 'inactive' ? 'Activate' : 'Deactivate'}</button></div></div>) : <div className="hq2Empty">No user profiles found for this district yet.</div>}</div>
          </section>}

          {view === 'branding' && <>
            <section className="hq2Card"><div className="hq2CardHeader"><div><h2>Theme Studio</h2><p>Branding belongs here in HQ, not scattered across admin pages.</p></div><select value={form.organization.org_code} onChange={(e) => { const d=districts.find((x)=>x.organization.org_code===e.target.value); if(d) chooseDistrict(d,'branding') }}>{districts.map((d)=><option key={d.organization.id} value={d.organization.org_code}>{d.organization.name}</option>)}</select></div>
              <div className="hq2Grid2"><div><div className="hq2FormGrid"><div className="hq2Field"><label>Accent color</label><input type="color" value={form.organization.district_accent_color} onChange={(e)=>updateOrg('district_accent_color',e.target.value)} /></div><div className="hq2Field"><label>Default Dock theme</label><select value={form.organization.default_theme} onChange={(e)=>updateOrg('default_theme',e.target.value)}>{THEMES.map(([id,name])=><option key={id} value={id}>{name}</option>)}</select></div><div className="hq2Field"><label>District logo</label><input type="file" accept="image/*" onChange={async(e)=>{const f=e.target.files?.[0];if(f)updateOrg('district_logo_url',await imageToDataUrl(f,600))}} /></div><div className="hq2Field"><label>Dock background</label><input type="file" accept="image/*" onChange={async(e)=>{const f=e.target.files?.[0];if(f)updateOrg('district_background_url',await imageToDataUrl(f,1600))}} /></div></div><div className="hq2Inline" style={{marginTop:12}}><button className="hq2Ghost" onClick={()=>updateOrg('district_logo_url','')}>Clear logo</button><button className="hq2Ghost" onClick={()=>updateOrg('district_background_url','')}>Clear background</button></div></div>
                <div className="hq2Preview" style={{ backgroundColor: form.organization.district_accent_color, backgroundImage: form.organization.district_background_url ? `linear-gradient(rgba(10,28,48,.25),rgba(10,28,48,.25)),url(${form.organization.district_background_url})` : undefined }}>{form.organization.district_logo_url ? <img src={form.organization.district_logo_url} alt="District logo" /> : null}<strong>{form.organization.name || 'District'}</strong><span>{THEMES.find(([id])=>id===form.organization.default_theme)?.[1] || 'Dock Green'} · managed Dock</span></div>
              </div>
            </section>
            <section className="hq2Card"><h2>Theme library</h2><p>Choose the district default here. Users may still have personal themes where allowed.</p><div className="hq2ThemeGrid" style={{marginTop:14}}>{THEMES.map(([id,name])=><button key={id} className={`hq2Theme ${form.organization.default_theme===id?'selected':''}`} onClick={()=>updateOrg('default_theme',id)}><div className={`hq2Swatch ${id}`}></div><strong>{name}</strong></button>)}</div></section>
          </>}

          {view === 'operations' && <section className="hq2Card"><div className="hq2CardHeader"><div><h2>Operations</h2><p>Owner-level system health and release controls.</p></div></div><div className="hq2Ops"><div className="hq2Op"><strong>Owner authentication</strong><span>Online · signed in as {user.email}</span></div><div className="hq2Op"><strong>District records</strong><span>{districts.length} loaded from Supabase</span></div><div className="hq2Op"><strong>License enforcement</strong><span>Trial / active / past due / suspended / expired controls are available</span></div><div className="hq2Op"><strong>Release enforcement</strong><span>Minimum extension version is stored per district</span></div><div className="hq2Op"><strong>Workspace versions</strong><span>{selected?.workspaceVersions?.length || 0} recent versions loaded for selected district</span></div><div className="hq2Op"><strong>Audit trail</strong><span>{selected?.auditLogs?.length || 0} recent owner/system events loaded</span></div><div className="hq2Op"><strong>Billing automation</strong><span>Not finished: Stripe payment state still needs to become the single source of license truth</span></div><div className="hq2Op"><strong>Production deployment</strong><span>Not controlled from HQ yet; keep Vercel release steps separate until safely wired</span></div></div><div className="hq2Notice">This page intentionally does not expose raw JSON/API buttons. Diagnostics should be readable owner tools, not implementation details.</div></section>}

          {dirty && <div className="hq2SaveBar"><span>Unsaved owner changes for {form.organization.name || 'new district'}.</span><button className="hq2Primary" onClick={saveDistrict} disabled={loading}>{loading ? 'Saving…' : 'Save changes'}</button></div>}
          {!dirty && <div className="hq2Notice">{status}</div>}
        </main>
      </div>
    </div>
  )
}
