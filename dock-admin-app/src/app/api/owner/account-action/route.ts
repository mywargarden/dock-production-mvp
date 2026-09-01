export const dynamic='force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { loadOwnerDistricts, normalize, requireOwner } from '@/lib/ownerServer'

const ACTIONS=new Set(['suspend','reactivate','archive'])

export async function POST(request:NextRequest){
  try{
    const auth=await requireOwner(request);if('error' in auth)return auth.error
    const body=await request.json()
    const organizationId=normalize(body?.organizationId)
    const action=normalize(body?.action).toLowerCase()
    const reason=normalize(body?.reason)
    const confirmation=normalize(body?.confirmation)
    if(!organizationId||!ACTIONS.has(action))return NextResponse.json({error:'A valid organization and account action are required.'},{status:400})
    if(reason.length<5)return NextResponse.json({error:'Enter a reason for this account action.'},{status:400})
    if(confirmation!=='CONFIRM')return NextResponse.json({error:'Type CONFIRM to authorize this account action.'},{status:400})

    const {data:organization,error}=await auth.service.rpc('dock_owner_account_action',{
      p_organization_id:organizationId,
      p_action:action,
      p_reason:reason,
      p_actor_email:auth.ownerEmail,
    })
    if(error)throw error

    return NextResponse.json({ok:true,organization,districts:await loadOwnerDistricts(auth.service)})
  }catch(error:any){return NextResponse.json({error:error?.message||'Could not complete account action.'},{status:400})}
}
