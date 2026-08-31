'use client'

import { useEffect, useMemo, useState } from 'react'
import { getAccessToken, getUser, signIn, signOut } from '@/lib/auth'
import '../owner-hq.css'

type Action='suspend'|'reactivate'|'archive'

type District=any

type ActivityResponse={activity:any[];nextCursor:string|null;hasMore:boolean}

export default function DockHqRc1(){
  const [user,setUser]=useState<any>(null)
  const [districts,setDistricts]=useState<District[]>([])
  const [selectedId,setSelectedId]=useState('')
  const [status,setStatus]=useState('Dock HQ RC1 ready.')
  const [busy,setBusy]=useState(false)

  const [workspaceHistory,setWorkspaceHistory]=useState<any[]>([])
  const [workspaceLive,setWorkspaceLive]=useState<any>(null)
  const [snapshotId,setSnapshotId]=useState('')
  const [comparison,setComparison]=useState<any>(null)

  const [themes,setThemes]=useState<any[]>([])
  const [themeId,setThemeId]=useState('')
  const [themeVersions,setThemeVersions]=useState<any[]>([])

  const [activity,setActivity]=useState<any[]>([])
  const [activityCursor,setActivityCursor]=useState<string|null>(null)
  const [activityHasMore,setActivityHasMore]=useState(false)
  const [activitySearch,setActivitySearch]=useState('')

  const [diagnostics,setDiagnostics]=useState<any>(null)
  const [diagEmail,setDiagEmail]=useState('')

  const selected=useMemo(()=>districts.find(d=>d.organization?.id===selectedId)||null,[districts,selectedId])

  useEffect(()=>{(async()=>{const u=await getUser();setUser(u);if(u){await Promise.all([loadDistricts(),loadThemes(),loadActivity(true)])}})()},[])

  async function authFetch(url:string,opts:any={}){
    const token=await getAccessToken()
    if(!token)throw new Error('Sign in again.')
    return fetch(url,{...opts,headers:{...(opts.headers||{}),Authorization:`Bearer ${token}`}})
  }

  async function loadDistricts(){
    const r=await authFetch('/api/owner/districts',{cache:'no-store'})
    const j=await r.json()
    if(!r.ok)throw new Error(j.error||'Could not load districts.')
    setDistricts(j.districts||[])
    if(!selectedId&&j.districts?.[0]?.organization?.id)setSelectedId(j.districts[0].organization.id)
  }

  async function loadWorkspace(organizationId=selectedId){
    if(!organizationId){setWorkspaceHistory([]);setWorkspaceLive(null);return}
    const r=await authFetch(`/api/owner/workspaces?organizationId=${encodeURIComponent(organizationId)}`,{cache:'no-store'})
    const j=await r.json()
    if(!r.ok)throw new Error(j.error||'Could not load workspace history.')
    setWorkspaceHistory(j.versions||[])
    setWorkspaceLive(j.live||null)
    setSnapshotId(j.versions?.[0]?.id||'')
    setComparison(null)
  }

  async function compareWorkspace(){
    if(!selectedId||!snapshotId)return
    setBusy(true)
    try{
      const r=await authFetch(`/api/owner/workspaces/compare?organizationId=${encodeURIComponent(selectedId)}&snapshotId=${encodeURIComponent(snapshotId)}`,{cache:'no-store'})
      const j=await r.json()
      if(!r.ok)throw new Error(j.error||'Compare failed.')
      setComparison(j.comparison)
      setStatus(`Compared live workspace with snapshot v${j.comparison?.snapshot?.version??'?'}.`)
    }catch(e:any){setStatus(e.message)}finally{setBusy(false)}
  }

  async function restoreWorkspace(){
    if(!selectedId||!snapshotId)return
    const reason=window.prompt('Reason for workspace restore:')||''
    if(reason.trim().length<5){setStatus('Restore cancelled: enter a reason of at least 5 characters.');return}
    const confirmText=window.prompt('Type RESTORE to apply this snapshot:')||''
    if(confirmText!=='RESTORE'){setStatus('Restore cancelled.');return}
    setBusy(true)
    try{
      const r=await authFetch('/api/owner/workspaces/restore',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({organizationId:selectedId,snapshotId,reason})})
      const j=await r.json()
      if(!r.ok)throw new Error(j.error||'Restore failed.')
      setDistricts(j.districts||districts)
      await Promise.all([loadWorkspace(selectedId),loadActivity(true)])
      setStatus(`Workspace restored. New live version: v${j.restored?.liveVersion??'?'}.`)
    }catch(e:any){setStatus(e.message)}finally{setBusy(false)}
  }

  async function accountAction(action:Action){
    if(!selectedId)return
    const reason=window.prompt(`Reason to ${action} ${selected?.organization?.name||'district'}:`)||''
    if(reason.trim().length<5){setStatus('Account action cancelled: enter a meaningful reason.');return}
    const confirmation=window.prompt('Type CONFIRM to authorize this account action:')||''
    if(confirmation!=='CONFIRM'){setStatus('Account action cancelled.');return}
    setBusy(true)
    try{
      const r=await authFetch('/api/owner/account-action',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({organizationId:selectedId,action,reason,confirmation})})
      const j=await r.json()
      if(!r.ok)throw new Error(j.error||'Account action failed.')
      setDistricts(j.districts||districts)
      await loadActivity(true)
      setStatus(`${action} completed and audited.`)
    }catch(e:any){setStatus(e.message)}finally{setBusy(false)}
  }

  async function loadThemes(){
    const r=await authFetch('/api/owner/themes',{cache:'no-store'})
    const j=await r.json()
    if(!r.ok)throw new Error(j.error||'Could not load themes.')
    setThemes(j.themes||[])
  }

  async function loadThemeVersions(id:string){
    setThemeId(id)
    setThemeVersions([])
    if(!id)return
    const r=await authFetch(`/api/owner/themes?themeId=${encodeURIComponent(id)}`,{cache:'no-store'})
    const j=await r.json()
    if(!r.ok)throw new Error(j.error||'Could not load theme versions.')
    setThemes(j.themes||themes)
    setThemeVersions(j.versions||[])
  }

  async function themeLifecycle(action:'archive'|'restore'){
    if(!themeId)return
    const theme=themes.find(t=>t.id===themeId)
    if(!window.confirm(`${action==='archive'?'Archive':'Restore'} ${theme?.name||'this theme'}?`))return
    setBusy(true)
    try{
      const r=await authFetch('/api/owner/themes',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,id:themeId})})
      const j=await r.json()
      if(!r.ok)throw new Error(j.error||'Theme action failed.')
      setThemes(j.themes||themes)
      setThemeVersions(j.versions||[])
      await loadActivity(true)
      setStatus(`Theme ${action} completed and audited.`)
    }catch(e:any){setStatus(e.message)}finally{setBusy(false)}
  }

  async function restoreThemeVersion(versionId:string){
    if(!themeId||!versionId)return
    const reason=window.prompt('Reason for theme version restore:')||''
    if(reason.trim().length<5){setStatus('Theme restore cancelled: enter a reason of at least 5 characters.');return}
    const confirmText=window.prompt('Type RESTORE to restore this theme version as a new draft:')||''
    if(confirmText!=='RESTORE'){setStatus('Theme restore cancelled.');return}
    setBusy(true)
    try{
      const r=await authFetch('/api/owner/themes/restore',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({themeId,versionId,reason})})
      const j=await r.json()
      if(!r.ok)throw new Error(j.error||'Theme version restore failed.')
      setThemes(j.themes||themes)
      setThemeVersions(j.versions||[])
      await loadActivity(true)
      setStatus(`Theme version restored as new draft v${j.theme?.version??'?'}.`)
    }catch(e:any){setStatus(e.message)}finally{setBusy(false)}
  }

  async function loadActivity(reset=false){
    const params=new URLSearchParams({limit:'40'})
    if(activitySearch)params.set('search',activitySearch)
    if(selectedId)params.set('organizationId',selectedId)
    if(!reset&&activityCursor)params.set('before',activityCursor)
    const r=await authFetch(`/api/owner/activity?${params.toString()}`,{cache:'no-store'})
    const j:ActivityResponse&{error?:string}=await r.json()
    if(!r.ok)throw new Error(j.error||'Could not load activity.')
    setActivity(c=>reset?j.activity:[...c,...j.activity])
    setActivityCursor(j.nextCursor)
    setActivityHasMore(j.hasMore)
  }

  async function runDiagnostics(){
    const q=diagEmail?`?email=${encodeURIComponent(diagEmail)}`:''
    setBusy(true)
    try{
      const r=await authFetch(`/api/owner/diagnostics${q}`,{cache:'no-store'})
      const j=await r.json()
      if(!r.ok)throw new Error(j.error||'Diagnostics failed.')
      setDiagnostics(j.report)
      setStatus('Structured diagnostics complete.')
    }catch(e:any){setStatus(e.message)}finally{setBusy(false)}
  }

  useEffect(()=>{if(user&&selectedId){loadWorkspace(selectedId).catch(e=>setStatus(e.message));loadActivity(true).catch(e=>setStatus(e.message))}},[selectedId])

  if(!user)return <main className="hq2SignIn"><section className="hq2SignInCard"><div className="hq2Logo">D</div><div className="hq2Eyebrow" style={{color:'#9cc8ff',marginTop:20}}>Dock 1.0 RC1</div><h1>Dock HQ</h1><p>Owner-only convergence console for command → effect → evidence.</p><button onClick={signIn}>Enter Dock HQ</button></section></main>

  const selectedTheme=themes.find(t=>t.id===themeId)

  return <div className="hq2Shell">
    <header className="hq2Top"><div className="hq2TopInner"><div className="hq2Brand"><div className="hq2Logo">D</div><div><strong>Dock HQ · RC1</strong><span>Command → Effect → Evidence</span></div></div><div className="hq2TopActions"><select value={selectedId} onChange={e=>setSelectedId(e.target.value)}><option value="">All Districts</option>{districts.map(d=><option key={d.organization.id} value={d.organization.id}>{d.organization.name}</option>)}</select><a className="hq2Ghost" href="/hq-v4-test">HQ V4</a><button onClick={()=>Promise.all([loadDistricts(),loadThemes(),loadActivity(true),selectedId?loadWorkspace(selectedId):Promise.resolve()])}>{busy?'Working…':'Refresh'}</button><button onClick={signOut}>Sign out</button></div></div></header>

    <main className="hq2Content" style={{maxWidth:1200,margin:'0 auto'}}>
      <section className="hq2Hero"><div><div className="hq2Eyebrow">Dock 1.0 RC1 Convergence</div><h1>{selected?.organization?.name||'Owner operations'}</h1><p>Close the launch-critical loops before destructive 7 testing.</p></div><span className="hq2Badge">Owner authenticated</span></section>

      <section className="hq2Card"><strong>{status}</strong></section>

      {selected&&<section className="hq2Grid2">
        <div className="hq2Card"><h2>Account lifecycle</h2><p>Real audited owner actions. These no longer wait for a generic district save.</p><div className="hq2Ops"><div className="hq2Op"><strong>License</strong><span>{selected.organization.license_status}</span></div><div className="hq2Op"><strong>Lifecycle</strong><span>{selected.organization.customer_lifecycle}</span></div></div><div className="hq2Inline" style={{marginTop:14}}><button className="hq2Danger" onClick={()=>accountAction('suspend')}>Suspend</button><button className="hq2Ghost" onClick={()=>accountAction('archive')}>Archive</button><button className="hq2Primary" onClick={()=>accountAction('reactivate')}>Reactivate</button></div></div>
        <div className="hq2Card"><h2>Live customer state</h2><div className="hq2Ops"><div className="hq2Op"><strong>Org code</strong><span>{selected.organization.org_code}</span></div><div className="hq2Op"><strong>Workspace</strong><span>{workspaceLive?`v${workspaceLive.version} · ${workspaceLive.name}`:'Missing'}</span></div><div className="hq2Op"><strong>Users</strong><span>{selected.activeSeatCount||0}/{selected.organization.max_users||0}</span></div></div><div className="hq2Inline" style={{marginTop:14}}><a className="hq2Ghost" href={`/district/${encodeURIComponent(selected.organization.org_code)}`} target="_blank">Preview Live</a><a className="hq2Ghost" href="/admin" target="_blank">District Admin</a></div></div>
      </section>}

      {selected&&<section className="hq2Card"><div className="hq2CardHeader"><div><h2>Workspace recovery</h2><p>Compare a retained snapshot against live state, then restore it as a new auditable live version.</p></div></div>{workspaceHistory.length?<><div className="hq2Inline"><select value={snapshotId} onChange={e=>{setSnapshotId(e.target.value);setComparison(null)}}>{workspaceHistory.map(v=><option key={v.id} value={v.id}>v{v.version} · {v.name} · {new Date(v.published_at||v.created_at).toLocaleString()}</option>)}</select><button className="hq2Ghost" onClick={compareWorkspace}>Compare to live</button><button className="hq2Danger" onClick={restoreWorkspace}>Restore snapshot</button></div>{comparison&&<div className="hq2Grid2" style={{marginTop:16}}><div className="hq2Card"><h3>Live → snapshot</h3><div className="hq2Ops"><div className="hq2Op"><strong>Change count</strong><span>{comparison.changeCount}</span></div><div className="hq2Op"><strong>Resources added by restore</strong><span>{comparison.resources?.added?.length||0}</span></div><div className="hq2Op"><strong>Resources removed by restore</strong><span>{comparison.resources?.removed?.length||0}</span></div><div className="hq2Op"><strong>Branding changes</strong><span>{comparison.brandingChanges?.length||0}</span></div></div></div><div className="hq2Card"><h3>Selected snapshot</h3><div className="hq2Ops"><div className="hq2Op"><strong>Snapshot</strong><span>v{comparison.snapshot?.version}</span></div><div className="hq2Op"><strong>Resources</strong><span>{comparison.snapshot?.resourceCount}</span></div><div className="hq2Op"><strong>Name change</strong><span>{comparison.workspaceNameChanged?'Yes':'No'}</span></div></div></div></div>}</>:<div className="hq2Empty">No retained workspace snapshots exist for this district.</div>}</section>}

      <section className="hq2Card"><div className="hq2CardHeader"><div><h2>Theme recovery</h2><p>Expose archive/restore lifecycle and historical version restore without touching SQL.</p></div></div><div className="hq2Inline"><select value={themeId} onChange={e=>loadThemeVersions(e.target.value)}><option value="">Choose a theme</option>{themes.map(t=><option key={t.id} value={t.id}>{t.name} · {t.status} · v{t.version}</option>)}</select>{selectedTheme&&<><button className="hq2Ghost" onClick={()=>themeLifecycle(selectedTheme.status==='archived'?'restore':'archive')}>{selectedTheme.status==='archived'?'Restore theme':'Archive theme'}</button></>}</div>{themeVersions.length?<table className="hq2Table" style={{marginTop:14}}><thead><tr><th>Version</th><th>Name</th><th>Created</th><th/></tr></thead><tbody>{themeVersions.map(v=><tr key={v.id}><td>v{v.version}</td><td>{v.name}</td><td>{new Date(v.created_at).toLocaleString()}</td><td><button className="hq2Ghost" disabled={selectedTheme?.status==='archived'} onClick={()=>restoreThemeVersion(v.id)}>Restore as new draft</button></td></tr>)}</tbody></table>:themeId?<div className="hq2Empty">No theme versions found.</div>:null}</section>

      <section className="hq2Card"><div className="hq2CardHeader"><div><h2>Structured diagnostics</h2><p>PASS / WARNING / FAIL evidence from the real owner diagnostics API.</p></div><div className="hq2Inline"><input placeholder="Optional user email" value={diagEmail} onChange={e=>setDiagEmail(e.target.value)}/><button className="hq2Primary" onClick={runDiagnostics}>Run diagnostics</button></div></div>{diagnostics&&<><section className="hq2Metrics"><div className="hq2Metric"><span>Pass</span><strong>{diagnostics.summary?.pass||0}</strong></div><div className="hq2Metric"><span>Warnings</span><strong>{diagnostics.summary?.warning||0}</strong></div><div className="hq2Metric"><span>Fail</span><strong>{diagnostics.summary?.fail||0}</strong></div><div className="hq2Metric"><span>Districts</span><strong>{diagnostics.districtCount||0}</strong></div></section>{diagnostics.resolution&&<div className="hq2Notice"><strong>Identity resolution:</strong> {diagnostics.resolution.access} · {diagnostics.resolution.reason}</div>}<div className="hq2Ops">{diagnostics.checks?.map((c:any)=><div className="hq2Op" key={c.key}><strong>{c.label} · {String(c.status).toUpperCase()}</strong><span>{c.summary}{c.recommendation?` · ${c.recommendation}`:''}</span></div>)}</div></>}</section>

      <section className="hq2Card"><div className="hq2CardHeader"><div><h2>Activity evidence</h2><p>Paginated server-backed audit history.</p></div><div className="hq2Inline"><input placeholder="Search audit history" value={activitySearch} onChange={e=>setActivitySearch(e.target.value)}/><button className="hq2Ghost" onClick={()=>loadActivity(true)}>Search</button></div></div>{activity.length?<table className="hq2Table"><thead><tr><th>When</th><th>District</th><th>Action</th><th>Actor</th><th>Target</th></tr></thead><tbody>{activity.map(a=><tr key={a.id}><td>{new Date(a.created_at).toLocaleString()}</td><td>{a.district_name||'Global'}</td><td>{a.action}</td><td>{a.actor_email||'System'}</td><td>{a.target_type||'—'}</td></tr>)}</tbody></table>:<div className="hq2Empty">No activity returned.</div>}{activityHasMore&&<button className="hq2Ghost" style={{marginTop:14}} onClick={()=>loadActivity(false)}>Load more</button>}</section>
    </main>
  </div>
}
