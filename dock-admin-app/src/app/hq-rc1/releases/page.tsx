'use client'

import { useEffect, useMemo, useState } from 'react'
import { getAccessToken, getUser, signIn } from '@/lib/auth'

export default function Rc1Releases(){
  const [user,setUser]=useState<any>(null)
  const [releases,setReleases]=useState<any[]>([])
  const [versionCounts,setVersionCounts]=useState<Record<string,number>>({})
  const [adoption,setAdoption]=useState<any[]>([])
  const [draft,setDraft]=useState<any>({version:'',channel:'development',status:'draft',deployment_url:'',chrome_status:'',notes_internal:'',notes_public:'',build_verified:false,migrations_verified:false,managed_config_verified:false,theme_runtime_verified:false})
  const [status,setStatus]=useState('Loading releases…')
  const [busy,setBusy]=useState(false)

  const current=useMemo(()=>releases.find(r=>r.status==='production')||null,[releases])
  useEffect(()=>{(async()=>{const u=await getUser();setUser(u);if(u)await load()})()},[])
  async function authFetch(url:string,opts:any={}){const token=await getAccessToken();if(!token)throw new Error('Sign in again.');return fetch(url,{...opts,headers:{...(opts.headers||{}),Authorization:`Bearer ${token}`}})}
  async function load(){try{const r=await authFetch('/api/owner/releases',{cache:'no-store'}),j=await r.json();if(!r.ok)throw new Error(j.error||'Could not load releases.');setReleases(j.releases||[]);setVersionCounts(j.versionCounts||{});setAdoption(j.adoption||[]);setStatus('Release state loaded.')}catch(e:any){setStatus(e.message)}}
  function patch(k:string,v:any){setDraft((c:any)=>({...c,[k]:v}))}
  async function save(action='save'){
    setBusy(true)
    try{const r=await authFetch('/api/owner/releases',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...draft,action})}),j=await r.json();if(!r.ok)throw new Error(j.error||'Release action failed.');setReleases(j.releases||[]);setVersionCounts(j.versionCounts||{});setAdoption(j.adoption||[]);setStatus(action==='save'?'Release saved.':action==='approve_preview'?'Preview approved.':'Production approved.')}catch(e:any){setStatus(e.message)}finally{setBusy(false)}}
  if(!user)return <main className="hq2SignIn"><section className="hq2SignInCard"><h1>Dock RC1 Releases</h1><p>Owner authentication required.</p><button onClick={signIn}>Sign in</button></section></main>
  return <main className="hq2Content" style={{maxWidth:1100,margin:'0 auto'}}>
    <section className="hq2Hero"><div><div className="hq2Eyebrow">Dock 1.0 RC1</div><h1>Release Control</h1><p>Freeze one artifact, prove it, then promote it deliberately.</p></div></section>
    <section className="hq2Card"><strong>{status}</strong></section>
    <section className="hq2Grid2"><div className="hq2Card"><h2>Production state</h2><div className="hq2Ops"><div className="hq2Op"><strong>Current production</strong><span>{current?.version||'None recorded'}</span></div><div className="hq2Op"><strong>Deployment</strong><span>{current?.deployment_url||'—'}</span></div></div></div><div className="hq2Card"><h2>Version telemetry</h2>{Object.keys(versionCounts).length?Object.entries(versionCounts).map(([v,n])=><div className="hq2User" key={v}><strong>{v}</strong><span>{n} installs</span></div>):<div className="hq2Empty">No installation telemetry yet.</div>}</div></section>
    <section className="hq2Card"><h2>Prepare RC</h2><div className="hq2FormGrid">{[['Version','version'],['Deployment URL','deployment_url'],['Chrome status','chrome_status'],['Internal notes','notes_internal'],['Public notes','notes_public']].map(([label,key])=><div className={`hq2Field ${key.includes('notes')?'full':''}`} key={key}><label>{label}</label>{key.includes('notes')?<textarea value={draft[key]||''} onChange={e=>patch(key,e.target.value)}/>:<input value={draft[key]||''} onChange={e=>patch(key,e.target.value)}/>}</div>)}<div className="hq2Field"><label>Channel</label><select value={draft.channel} onChange={e=>patch('channel',e.target.value)}>{['development','pilot','beta','production'].map(x=><option key={x}>{x}</option>)}</select></div><div className="hq2Field"><label>Status</label><select value={draft.status} onChange={e=>patch('status',e.target.value)}>{['draft','preview','production','paused','retired'].map(x=><option key={x}>{x}</option>)}</select></div></div>
      {['build_verified','migrations_verified','managed_config_verified','theme_runtime_verified'].map(k=><label className="hq2Check" key={k}><input type="checkbox" checked={draft[k]===true} onChange={e=>patch(k,e.target.checked)}/>{k.replace(/_/g,' ')}</label>)}
      <div className="hq2Inline" style={{marginTop:14}}><button className="hq2Ghost" disabled={busy} onClick={()=>save('save')}>Save release</button><button className="hq2Primary" disabled={busy} onClick={()=>save('approve_preview')}>Approve preview</button><button className="hq2Danger" disabled={busy} onClick={()=>save('approve_production')}>Approve production</button></div>
    </section>
    <section className="hq2Card"><h2>Adoption by district</h2>{adoption.length?<table className="hq2Table"><thead><tr><th>District</th><th>Minimum</th><th>Total</th><th>Versions</th><th>Last seen</th></tr></thead><tbody>{adoption.map((a:any)=><tr key={a.organizationId||a.district}><td>{a.district}</td><td>{a.minimumVersion||'—'}</td><td>{a.total}</td><td>{Object.entries(a.versions||{}).map(([v,n])=>`${v}:${n}`).join(', ')}</td><td>{a.lastSeen?new Date(a.lastSeen).toLocaleString():'—'}</td></tr>)}</tbody></table>:<div className="hq2Empty">No adoption data yet.</div>}</section>
  </main>
}
