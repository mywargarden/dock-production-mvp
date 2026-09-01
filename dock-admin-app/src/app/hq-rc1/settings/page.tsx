'use client'

import { useEffect, useState } from 'react'
import { getAccessToken, getUser, signIn } from '@/lib/auth'

type Settings=Record<string,any>

export default function Rc1Settings(){
  const [user,setUser]=useState<any>(null)
  const [settings,setSettings]=useState<Settings>({})
  const [status,setStatus]=useState('Loading owner settings…')
  const [meta,setMeta]=useState<any>({})
  const [busy,setBusy]=useState(false)

  useEffect(()=>{(async()=>{const u=await getUser();setUser(u);if(u)await load()})()},[])
  async function authFetch(url:string,opts:any={}){const token=await getAccessToken();if(!token)throw new Error('Sign in again.');return fetch(url,{...opts,headers:{...(opts.headers||{}),Authorization:`Bearer ${token}`}})}
  async function load(){try{const r=await authFetch('/api/owner/settings',{cache:'no-store'}),j=await r.json();if(!r.ok)throw new Error(j.error||'Could not load settings.');setSettings(j.settings||{});setMeta(j);setStatus('Owner settings loaded.')}catch(e:any){setStatus(e.message)}}
  function patch(k:string,v:any){setSettings(c=>({...c,[k]:v}))}
  async function save(){setBusy(true);try{const r=await authFetch('/api/owner/settings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'save',settings})});const j=await r.json();if(!r.ok)throw new Error(j.error||'Save failed.');setSettings(j.settings||settings);setMeta(j);setStatus(`Saved. Changed: ${(j.changed||[]).join(', ')||'none'}.`)}catch(e:any){setStatus(e.message)}finally{setBusy(false)}}

  if(!user)return <main className="hq2SignIn"><section className="hq2SignInCard"><h1>Dock RC1 Settings</h1><p>Owner authentication required.</p><button onClick={signIn}>Sign in</button></section></main>

  return <main className="hq2Content" style={{maxWidth:1100,margin:'0 auto'}}>
    <section className="hq2Hero"><div><div className="hq2Eyebrow">Dock 1.0 RC1</div><h1>Owner Settings</h1><p>Defaults that are consumed when a new district is created.</p></div></section>
    <section className="hq2Card"><strong>{status}</strong>{meta.updated_at&&<div className="hq2Sub" style={{marginTop:6}}>Last updated {new Date(meta.updated_at).toLocaleString()} by {meta.updated_by||'unknown'}</div>}</section>

    <section className="hq2Card"><h2>District Birth defaults</h2><div className="hq2FormGrid">
      {[['Grace days','default_grace_days','number'],['Default seats','default_seats','number'],['Default plan','default_plan','text'],['Minimum extension version','default_minimum_version','text'],['Default theme','default_theme','text']].map(([label,key,type])=><div className="hq2Field" key={key}><label>{label}</label><input type={type} value={settings[key]??''} onChange={e=>patch(key,type==='number'?Number(e.target.value):e.target.value)}/></div>)}
    </div>
      <label className="hq2Check"><input type="checkbox" checked={settings.allow_user_theme_override===true} onChange={e=>patch('allow_user_theme_override',e.target.checked)}/>allow user theme override</label>
      <label className="hq2Check"><input type="checkbox" checked={settings.allow_admin_branding===true} onChange={e=>patch('allow_admin_branding',e.target.checked)}/>allow district admin branding</label>
      <p className="hq2Sub" style={{marginTop:10}}>Only settings with an RC1 runtime or district-Birth effect are exposed. Notifications, support automation, and global maintenance/emergency modes remain parked.</p>
    </section>

    <section className="hq2Card"><div className="hq2Inline"><button className="hq2Primary" disabled={busy} onClick={save}>Save settings</button></div></section>
  </main>
}
