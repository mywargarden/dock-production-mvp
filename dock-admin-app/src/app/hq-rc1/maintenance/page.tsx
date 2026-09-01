'use client'

import { useEffect, useState } from 'react'
import { getAccessToken, getUser, signIn } from '@/lib/auth'

export default function Rc1Maintenance(){
  const [user,setUser]=useState<any>(null)
  const [districts,setDistricts]=useState<any[]>([])
  const [selectedId,setSelectedId]=useState('')
  const [status,setStatus]=useState('Loading maintenance state…')
  const [busy,setBusy]=useState(false)
  const [result,setResult]=useState<any>(null)
  const [memoryResult,setMemoryResult]=useState<any>(null)

  useEffect(()=>{(async()=>{const u=await getUser();setUser(u);if(u)await load()})()},[])
  async function authFetch(url:string,opts:any={}){const token=await getAccessToken();if(!token)throw new Error('Sign in again.');return fetch(url,{...opts,headers:{...(opts.headers||{}),Authorization:`Bearer ${token}`}})}
  async function load(){
    try{
      const r=await authFetch('/api/owner/districts',{cache:'no-store'}),j=await r.json();if(!r.ok)throw new Error(j.error||'Could not load districts.')
      setDistricts(j.districts||[]);if(!selectedId&&j.districts?.[0]?.organization?.id)setSelectedId(j.districts[0].organization.id);setStatus('Maintenance ready.')
    }catch(e:any){setStatus(e.message)}
  }
  async function materialize(){
    if(!selectedId)return
    const district=districts.find(d=>d.organization?.id===selectedId)
    const confirmText=window.prompt(`Type MATERIALIZE to migrate inline managed assets for ${district?.organization?.name||'this district'}:`)||''
    if(confirmText!=='MATERIALIZE'){setStatus('Materialization cancelled.');return}
    setBusy(true);setResult(null)
    try{
      const r=await authFetch('/api/owner/maintenance/materialize-managed-assets',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({organizationId:selectedId})}),j=await r.json();if(!r.ok)throw new Error(j.error||'Materialization failed.')
      setResult(j);setStatus(`Managed assets materialized and audited for ${j.orgCode}.`);await load()
    }catch(e:any){setStatus(e.message)}finally{setBusy(false)}
  }
  async function materializeMemoryScreenshots(){
    const confirmText=window.prompt('Type MATERIALIZE to preserve legacy personal-memory screenshots in private storage:')||''
    if(confirmText!=='MATERIALIZE'){setStatus('Memory screenshot migration cancelled.');return}
    setBusy(true);setMemoryResult(null)
    try{
      const r=await authFetch('/api/owner/maintenance/materialize-memory-screenshots',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({confirmation:confirmText})}),j=await r.json();
      setMemoryResult(j)
      if(!r.ok)throw new Error(j.error||`Migration incomplete: ${j.failed||0} failed, ${j.remainingActive||0} active inline-only remain.`)
      setStatus(`Legacy memory screenshots preserved. ${j.migrated||0} migrated; ${j.remainingActive||0} active inline-only remain.`)
    }catch(e:any){setStatus(e.message)}finally{setBusy(false)}
  }

  if(!user)return <main className="hq2SignIn"><section className="hq2SignInCard"><h1>Dock RC1 Maintenance</h1><p>Owner authentication required.</p><button onClick={signIn}>Sign in</button></section></main>
  return <main className="hq2Content" style={{maxWidth:1100,margin:'0 auto'}}>
    <section className="hq2Hero"><div><div className="hq2Eyebrow">Dock 1.0 RC1</div><h1>Maintenance</h1><p>Owner-only, auditable repair transitions required to converge existing customer state with the current Dock architecture.</p></div></section>
    <section className="hq2Card"><strong>{status}</strong></section>
    <section className="hq2Card"><h2>Legacy memory screenshot preservation</h2><p>Moves active legacy inline personal-memory screenshots into the private screenshot bucket, assigns the secure proxy reference through the database trigger, and retires the duplicate inline representation. Current access rules remain unchanged.</p><div className="hq2Inline" style={{marginTop:14}}><button className="hq2Primary" disabled={busy} onClick={materializeMemoryScreenshots}>{busy?'Working…':'Preserve legacy screenshots'}</button></div>{memoryResult&&<div className="hq2Ops" style={{marginTop:16}}>{['found','migrated','failed','remainingActive','deletedLegacyRemaining'].map(key=><div className="hq2Op" key={key}><strong>{key}</strong><span>{String(memoryResult?.[key]??0)}</span></div>)}</div>}</section>
    <section className="hq2Card"><h2>Managed asset materialization</h2><p>Moves legacy inline branding and tab images into content-addressed managed storage across live, draft, and retained workspace history without changing the intended visual state.</p><div className="hq2Inline" style={{marginTop:14}}><select value={selectedId} onChange={e=>{setSelectedId(e.target.value);setResult(null)}}><option value="">Choose district</option>{districts.map(d=><option key={d.organization.id} value={d.organization.id}>{d.organization.name} · {d.organization.org_code}</option>)}</select><button className="hq2Primary" disabled={busy||!selectedId} onClick={materialize}>{busy?'Materializing…':'Materialize managed assets'}</button></div>{result&&<div className="hq2Ops" style={{marginTop:16}}>{Object.entries(result.counts||{}).map(([key,value])=><div className="hq2Op" key={key}><strong>{key}</strong><span>{String(value)}</span></div>)}</div>}</section>
  </main>
}
