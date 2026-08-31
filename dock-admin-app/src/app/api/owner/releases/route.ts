export const dynamic='force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { normalize, requireOwner } from '@/lib/ownerServer'

async function listReleases(service:any){
  const {data,error}=await service.from('dock_releases').select('*').order('created_at',{ascending:false})
  if(error)throw error
  const {data:installs,error:installError}=await service.from('extension_installations').select('organization_id,email,extension_version,last_seen_at')
  if(installError)throw installError
  const {data:orgs,error:orgError}=await service.from('organizations').select('id,name,org_code,minimum_extension_version')
  if(orgError)throw orgError
  const counts:Record<string,number>={}
  const orgMap=new Map((orgs||[]).map((o:any)=>[o.id,o]))
  const adoption:Record<string,any>={}
  for(const row of installs||[]){
    const v=normalize(row.extension_version)||'unknown';counts[v]=(counts[v]||0)+1
    const key=row.organization_id||'unassigned'
    const org:any=orgMap.get(row.organization_id)
    if(!adoption[key])adoption[key]={organizationId:row.organization_id||null,district:org?.name||'Unassigned',orgCode:org?.org_code||null,minimumVersion:org?.minimum_extension_version||null,total:0,versions:{},lastSeen:null}
    adoption[key].total++
    adoption[key].versions[v]=(adoption[key].versions[v]||0)+1
    if(row.last_seen_at&&(!adoption[key].lastSeen||new Date(row.last_seen_at)>new Date(adoption[key].lastSeen)))adoption[key].lastSeen=row.last_seen_at
  }
  return {releases:data||[],versionCounts:counts,installationCount:(installs||[]).length,adoption:Object.values(adoption)}
}

export async function GET(request:NextRequest){
  try{
    const auth=await requireOwner(request);if('error' in auth)return auth.error
    return NextResponse.json({ok:true,...await listReleases(auth.service)})
  }catch(error:any){return NextResponse.json({error:error?.message||'Could not load releases.'},{status:400})}
}

export async function POST(request:NextRequest){
  try{
    const auth=await requireOwner(request);if('error' in auth)return auth.error
    const body=await request.json();const action=normalize(body?.action)||'save'
    const version=normalize(body?.version)
    if(!version)return NextResponse.json({error:'Version is required.'},{status:400})
    const now=new Date().toISOString()
    const {data:existing,error:existingError}=await auth.service.from('dock_releases').select('*').eq('version',version).maybeSingle()
    if(existingError)throw existingError

    if(action==='approve_preview'||action==='approve_production'){
      if(!existing)return NextResponse.json({error:'Save the release first.'},{status:404})
      const {error}=await auth.service.rpc('dock_owner_transition_release',{
        p_release_id:existing.id,
        p_action:action,
        p_actor_email:auth.ownerEmail,
      })
      if(error)throw error
      return NextResponse.json({ok:true,...await listReleases(auth.service)})
    }

    const requestedChannel=normalize(body?.channel)
    const requestedStatus=normalize(body?.status)
    const protectedStatus=existing&&['preview','production'].includes(normalize(existing.status))
    const channel=existing?.status==='production'?'production':(['development','pilot','beta'].includes(requestedChannel)?requestedChannel:(existing?.channel||'development'))
    const status=protectedStatus?normalize(existing.status):(['draft','paused','retired'].includes(requestedStatus)?requestedStatus:(existing?.status||'draft'))
    const payload:any={version,channel,status,deployment_url:normalize(body?.deployment_url)||null,chrome_status:normalize(body?.chrome_status)||null,notes_internal:normalize(body?.notes_internal)||null,notes_public:normalize(body?.notes_public)||null,build_verified:body?.build_verified===true,migrations_verified:body?.migrations_verified===true,managed_config_verified:body?.managed_config_verified===true,theme_runtime_verified:body?.theme_runtime_verified===true,updated_at:now}
    if(existing){const {error}=await auth.service.from('dock_releases').update(payload).eq('id',existing.id);if(error)throw error}
    else{const {error}=await auth.service.from('dock_releases').insert({...payload,created_at:now});if(error)throw error}
    await auth.service.from('audit_logs').insert({organization_id:null,actor_email:auth.ownerEmail,action:'owner_save_release',target_type:'dock_release',target_id:existing?.id||version,details:{version,channel,status}}).throwOnError()
    return NextResponse.json({ok:true,...await listReleases(auth.service)})
  }catch(error:any){return NextResponse.json({error:error?.message||'Could not save release.'},{status:400})}
}
