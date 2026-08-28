export const dynamic='force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { normalize, normalizeEmail, requireOwner } from '@/lib/ownerServer'

export async function GET(request:NextRequest){
  try{
    const auth=await requireOwner(request);if('error' in auth)return auth.error
    const q=request.nextUrl.searchParams
    const organizationId=normalize(q.get('organizationId'))
    const actor=normalizeEmail(q.get('actor'))
    const action=normalize(q.get('action'))
    const targetType=normalize(q.get('targetType'))
    const search=normalize(q.get('search')).toLowerCase()
    const before=normalize(q.get('before'))
    const limit=Math.max(10,Math.min(100,Number(q.get('limit'))||40))

    let query=auth.service.from('audit_logs').select('id,organization_id,actor_user_id,actor_email,action,target_type,target_id,metadata,details,created_at').order('created_at',{ascending:false}).limit(limit+1)
    if(organizationId)query=query.eq('organization_id',organizationId)
    if(actor)query=query.ilike('actor_email',`%${actor}%`)
    if(action)query=query.eq('action',action)
    if(targetType)query=query.eq('target_type',targetType)
    if(before)query=query.lt('created_at',before)
    const {data,error}=await query
    if(error)throw error

    const orgIds=Array.from(new Set((data||[]).map((x:any)=>x.organization_id).filter(Boolean))) as string[]
    const orgMap=new Map<string,any>()
    if(orgIds.length){
      const {data:orgs,error:orgError}=await auth.service.from('organizations').select('id,name,org_code').in('id',orgIds)
      if(orgError)throw orgError
      for(const org of orgs||[])orgMap.set(org.id,org)
    }

    let rows=(data||[]).map((row:any)=>{const org=orgMap.get(row.organization_id);return {...row,district_name:org?.name||null,org_code:org?.org_code||null}})
    if(search)rows=rows.filter((row:any)=>`${row.district_name||''} ${row.org_code||''} ${row.actor_email||''} ${row.action||''} ${row.target_type||''} ${JSON.stringify(row.details||{})}`.toLowerCase().includes(search))
    const hasMore=rows.length>limit
    rows=rows.slice(0,limit)
    return NextResponse.json({ok:true,activity:rows,nextCursor:hasMore?rows[rows.length-1]?.created_at||null:null,hasMore})
  }catch(error:any){return NextResponse.json({error:error?.message||'Could not load activity.'},{status:400})}
}
