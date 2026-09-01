export const dynamic='force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { normalize, normalizeEmail, requireOwner } from '@/lib/ownerServer'

const defaults={default_trial_days:30,default_grace_days:30,default_plan:'district',default_seats:500,default_minimum_version:'',default_theme:'dock-green',allow_user_theme_override:true,allow_admin_branding:true,support_email:'',billing_email:'',support_url:'',notification_email:'',seat_threshold_percent:85,trial_notice_days:14,renewal_notice_days:60,notify_payment_failed:true,notify_trial_ending:true,notify_renewal:true,notify_suspension:true,notify_seat_threshold:true,notify_workspace_failure:true,notify_incident:true,notify_outdated_version:true,notify_new_admin:true,maintenance_mode:false,emergency_restrictions:false}

function safeSettings(raw:any){
 const next:any={...defaults,...(raw||{})}
 next.default_trial_days=Math.max(0,Math.min(3650,Number(next.default_trial_days)||0))
 next.default_grace_days=Math.max(0,Math.min(365,Number(next.default_grace_days)||0))
 next.default_seats=Math.max(1,Math.min(1000000,Number(next.default_seats)||1))
 next.seat_threshold_percent=Math.max(1,Math.min(100,Number(next.seat_threshold_percent)||85))
 next.trial_notice_days=Math.max(0,Math.min(365,Number(next.trial_notice_days)||14))
 next.renewal_notice_days=Math.max(0,Math.min(365,Number(next.renewal_notice_days)||60))
 next.support_email=normalizeEmail(next.support_email)||''
 next.billing_email=normalizeEmail(next.billing_email)||''
 next.notification_email=normalizeEmail(next.notification_email)||next.support_email||''
 next.support_url=normalize(next.support_url)
 next.default_minimum_version=normalize(next.default_minimum_version)
 next.default_theme=normalize(next.default_theme)||'dock-green'
 next.default_plan=normalize(next.default_plan)||'district'
 for(const key of ['allow_user_theme_override','allow_admin_branding','notify_payment_failed','notify_trial_ending','notify_renewal','notify_suspension','notify_seat_threshold','notify_workspace_failure','notify_incident','notify_outdated_version','notify_new_admin'])next[key]=next[key]===true
 // These controls have no RC1 runtime enforcement and therefore cannot be activated.
 next.maintenance_mode=false
 next.emergency_restrictions=false
 return next
}

export async function GET(request:NextRequest){
 const auth=await requireOwner(request);if('error' in auth)return auth.error
 const {data,error}=await auth.service.from('owner_settings').select('settings,updated_at,updated_by').eq('id','global').maybeSingle()
 if(error)return NextResponse.json({error:error.message},{status:400})
 return NextResponse.json({ok:true,scope:'global',settings:safeSettings(data?.settings),updated_at:data?.updated_at||null,updated_by:data?.updated_by||null})
}

export async function POST(request:NextRequest){
 const auth=await requireOwner(request);if('error' in auth)return auth.error
 const body=await request.json();const action=normalize(body?.action)||'save'
 if(action==='safety')return NextResponse.json({error:'Product-wide safety flags are parked in Dock 1.0 until runtime enforcement exists.',code:'SAFETY_FLAGS_NOT_ACTIVE'},{status:409})

 const {data:currentRow,error:readError}=await auth.service.from('owner_settings').select('settings').eq('id','global').maybeSingle()
 if(readError)return NextResponse.json({error:readError.message},{status:400})
 const current=safeSettings(currentRow?.settings)
 const next=safeSettings(body?.settings)
 const changed=Object.keys(next).filter(k=>JSON.stringify(current[k])!==JSON.stringify(next[k]))
 const {data:result,error}=await auth.service.rpc('dock_owner_save_settings',{
   p_settings:next,
   p_actor_email:auth.ownerEmail,
   p_action:'save',
   p_reason:null,
   p_changed:changed,
 })
 if(error)return NextResponse.json({error:error.message},{status:400})
 return NextResponse.json({ok:true,scope:'global',settings:safeSettings(result?.settings),updated_at:result?.updated_at||null,updated_by:result?.updated_by||auth.ownerEmail,changed})
}
