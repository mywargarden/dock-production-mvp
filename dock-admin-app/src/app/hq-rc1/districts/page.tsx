'use client'

import { useEffect, useMemo, useState } from 'react'
import { getAccessToken, getUser, signIn } from '@/lib/auth'

type DistrictForm={organization:any;domains:any[];admins:any[];allowedUsers:any[]}

const baseOrg={name:'',org_code:'',email_domain:'',plan:'district',max_users:500,license_status:'trial',license_renewal_date:'',grace_period_days:30,minimum_extension_version:'',owner_notes:'',district_logo_url:'',district_background_url:'',district_accent_color:'#2b8c8f',default_theme:'dock-green',allow_user_theme_override:true,allow_admin_branding:true,customer_lifecycle:'setup'}
const blank:DistrictForm={organization:{...baseOrg},domains:[],admins:[],allowedUsers:[]}

function norm(v:any){return String(v||'').trim()}
function slug(v:any){return norm(v).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'')}
function dateInput(v:any){if(!v)return '';const d=new Date(v);return Number.isNaN(d.getTime())?'':d.toISOString().slice(0,10)}
function toForm(item:any):DistrictForm{
 const o=item?.organization||{}
 return {organization:{...baseOrg,...o,license_renewal_date:dateInput(o.license_renewal_date)},domains:(item?.domains||[]).map((x:any)=>({...x,domain:x.domain||x.normalized_domain||''})),admins:item?.admins||[],allowedUsers:item?.allowedUsers||[]}
}

export default function Rc1Districts(){
 const [user,setUser]=useState<any>(null)
 const [districts,setDistricts]=useState<any[]>([])
 const [form,setForm]=useState<DistrictForm>(blank)
 const [selectedId,setSelectedId]=useState('')
 const [defaults,setDefaults]=useState<any>({})
 const [status,setStatus]=useState('Loading districts…')
 const [busy,setBusy]=useState(false)
 const selected=useMemo(()=>districts.find(d=>d.organization?.id===selectedId)||null,[districts,selectedId])

 useEffect(()=>{(async()=>{const u=await getUser();setUser(u);if(u)await loadAll()})()},[])
 async function authFetch(url:string,opts:any={}){const token=await getAccessToken();if(!token)throw new Error('Sign in again.');return fetch(url,{...opts,headers:{...(opts.headers||{}),Authorization:`Bearer ${token}`}})}
 async function loadAll(){
  try{
   const [dr,sr]=await Promise.all([authFetch('/api/owner/districts',{cache:'no-store'}),authFetch('/api/owner/settings',{cache:'no-store'})])
   const [dj,sj]=await Promise.all([dr.json(),sr.json()]);if(!dr.ok)throw new Error(dj.error||'Could not load districts.');if(!sr.ok)throw new Error(sj.error||'Could not load owner defaults.')
   setDistricts(dj.districts||[]);setDefaults(sj.settings||{});setStatus('District control loaded.')
  }catch(e:any){setStatus(e.message)}
 }
 function choose(id:string){setSelectedId(id);const d=districts.find(x=>x.organization?.id===id);if(d)setForm(toForm(d))}
 function newDistrict(){setSelectedId('');setForm({organization:{...baseOrg,plan:defaults.default_plan||'district',max_users:Number(defaults.default_seats)||500,grace_period_days:Number(defaults.default_grace_days)||30,minimum_extension_version:defaults.default_minimum_version||'',default_theme:defaults.default_theme||'dock-green',allow_user_theme_override:defaults.allow_user_theme_override!==false,allow_admin_branding:defaults.allow_admin_branding!==false},domains:[],admins:[],allowedUsers:[]});setStatus('New district draft. Save to create it atomically.')}
 function org(k:string,v:any){setForm(c=>({...c,organization:{...c.organization,[k]:v}}))}
 function add(kind:'domains'|'admins'|'allowedUsers'){
  const row=kind==='domains'?{domain:'',status:'verified',domain_type:'additional'}:kind==='admins'?{email:'',role:'district_admin',status:'active'}:{email:'',name:'',note:'',status:'active',expires_at:null}
  setForm(c=>({...c,[kind]:[...c[kind],row]}))
 }
 function patch(kind:'domains'|'admins'|'allowedUsers',i:number,k:string,v:any){setForm(c=>({...c,[kind]:c[kind].map((x:any,n:number)=>n===i?{...x,[k]:v}:x)}))}
 function remove(kind:'domains'|'admins'|'allowedUsers',i:number){setForm(c=>({...c,[kind]:c[kind].filter((_:any,n:number)=>n!==i)}))}
 async function save(){
  setBusy(true)
  try{
   const payload={...form,organization:{...form.organization,id:selected?.organization?.id||undefined,org_code:slug(form.organization.org_code),email_domain:norm(form.organization.email_domain).toLowerCase()}}
   const r=await authFetch('/api/owner/districts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}),j=await r.json();if(!r.ok)throw new Error(j.error||'District save failed.')
   setDistricts(j.districts||[]);const created=(j.districts||[]).find((d:any)=>d.organization?.id===j.organization?.id);if(created){setSelectedId(created.organization.id);setForm(toForm(created))}
   setStatus(`${j.organization?.name||'District'} saved atomically.`)
  }catch(e:any){setStatus(e.message)}finally{setBusy(false)}
 }

 if(!user)return <main className="hq2SignIn"><section className="hq2SignInCard"><h1>Dock RC1 Districts</h1><p>Owner authentication required.</p><button onClick={signIn}>Sign in</button></section></main>

 return <main className="hq2Content" style={{maxWidth:1200,margin:'0 auto'}}>
  <section className="hq2Hero"><div><div className="hq2Eyebrow">Dock 1.0 RC1</div><h1>District Birth & Control</h1><p>The canonical owner path for creating and editing tenant identity, capacity, licensing and delegated access.</p></div><button className="hq2Primary" onClick={newDistrict}>New district</button></section>
  <section className="hq2Card"><strong>{status}</strong></section>
  <section className="hq2Grid2">
   <div className="hq2Card"><h2>Districts</h2><div className="hq2Field"><label>Choose district</label><select value={selectedId} onChange={e=>choose(e.target.value)}><option value="">New / none selected</option>{districts.map(d=><option key={d.organization.id} value={d.organization.id}>{d.organization.name} · {d.organization.org_code}</option>)}</select></div><p className="hq2Sub">{districts.length} tenant record(s). Existing org codes are immutable.</p></div>
   <div className="hq2Card"><h2>Command boundary</h2><p>Save writes the organization, verified domains, district admins and explicit allowed users as one database transition with audit evidence.</p></div>
  </section>

  <section className="hq2Card"><h2>Organization</h2><div className="hq2FormGrid">
   {[['District name','name','text'],['Org code','org_code','text'],['Primary domain','email_domain','text'],['Plan','plan','text'],['Maximum users','max_users','number'],['Grace days','grace_period_days','number'],['Minimum extension version','minimum_extension_version','text'],['Default theme','default_theme','text']].map(([label,key,type])=><div className="hq2Field" key={key}><label>{label}</label><input type={type} disabled={key==='org_code'&&!!selectedId} value={form.organization[key]??''} onChange={e=>org(key,type==='number'?Number(e.target.value):e.target.value)}/></div>)}
   <div className="hq2Field"><label>License status</label><select value={form.organization.license_status||'trial'} onChange={e=>org('license_status',e.target.value)}>{['trial','active','past_due','suspended','expired'].map(x=><option key={x}>{x}</option>)}</select></div>
   <div className="hq2Field"><label>Customer lifecycle</label><select value={form.organization.customer_lifecycle||'setup'} onChange={e=>org('customer_lifecycle',e.target.value)}>{['lead','setup','trial','active','offboarding','archived'].map(x=><option key={x}>{x}</option>)}</select></div>
   <div className="hq2Field"><label>Renewal date</label><input type="date" value={form.organization.license_renewal_date||''} onChange={e=>org('license_renewal_date',e.target.value)}/></div>
   <div className="hq2Field"><label>Accent color</label><input type="color" value={form.organization.district_accent_color||'#2b8c8f'} onChange={e=>org('district_accent_color',e.target.value)}/></div>
   <div className="hq2Field full"><label>Owner notes</label><textarea value={form.organization.owner_notes||''} onChange={e=>org('owner_notes',e.target.value)}/></div>
  </div><label className="hq2Check"><input type="checkbox" checked={form.organization.allow_user_theme_override!==false} onChange={e=>org('allow_user_theme_override',e.target.checked)}/>allow user theme override</label><label className="hq2Check"><input type="checkbox" checked={form.organization.allow_admin_branding!==false} onChange={e=>org('allow_admin_branding',e.target.checked)}/>allow district admin branding</label></section>

  <section className="hq2Card"><h2>Verified domains</h2>{form.domains.map((x:any,i:number)=><div className="hq2MiniRow" key={i}><input value={x.domain||''} placeholder="district.example" onChange={e=>patch('domains',i,'domain',e.target.value)}/><select value={x.status||'verified'} onChange={e=>patch('domains',i,'status',e.target.value)}><option>verified</option><option>pending</option></select><select value={x.domain_type||'additional'} onChange={e=>patch('domains',i,'domain_type',e.target.value)}><option>primary</option><option>additional</option></select><button onClick={()=>remove('domains',i)}>Remove</button></div>)}<button className="hq2Ghost" onClick={()=>add('domains')}>Add domain</button></section>

  <section className="hq2Card"><h2>District admins</h2>{form.admins.map((x:any,i:number)=><div className="hq2MiniRow" key={i}><input type="email" value={x.email||''} placeholder="admin@district.org" onChange={e=>patch('admins',i,'email',e.target.value)}/><select value={x.role||'district_admin'} onChange={e=>patch('admins',i,'role',e.target.value)}><option value="district_admin">district_admin</option><option value="owner">owner</option></select><select value={x.status||'active'} onChange={e=>patch('admins',i,'status',e.target.value)}><option>active</option><option>disabled</option></select><button onClick={()=>remove('admins',i)}>Remove</button></div>)}<button className="hq2Ghost" onClick={()=>add('admins')}>Add admin</button></section>

  <section className="hq2Card"><h2>Explicit allowed users</h2>{form.allowedUsers.map((x:any,i:number)=><div className="hq2MiniRow" key={i}><input type="email" value={x.email||''} placeholder="user@example.org" onChange={e=>patch('allowedUsers',i,'email',e.target.value)}/><input value={x.name||''} placeholder="Name" onChange={e=>patch('allowedUsers',i,'name',e.target.value)}/><select value={x.status||'active'} onChange={e=>patch('allowedUsers',i,'status',e.target.value)}><option>active</option><option>inactive</option></select><button onClick={()=>remove('allowedUsers',i)}>Remove</button></div>)}<button className="hq2Ghost" onClick={()=>add('allowedUsers')}>Add allowed user</button></section>

  <section className="hq2Card"><button className="hq2Primary" disabled={busy||!norm(form.organization.name)||!norm(form.organization.org_code)} onClick={save}>{busy?'Saving…':selectedId?'Save district':'Create district'}</button></section>
 </main>
}
