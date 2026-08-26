export const dynamic='force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { requireOwner } from '@/lib/ownerServer'

const defaults={default_trial_days:30,default_grace_days:30,default_plan:'district',default_seats:500,default_minimum_version:'',default_theme:'dock-green',allow_user_theme_override:true,allow_admin_branding:true,support_email:'',billing_email:'',support_url:'',notify_payment_failed:true,notify_trial_ending:true,notify_renewal:true,notify_suspension:true,notify_seat_threshold:true,notify_workspace_failure:true,notify_incident:true,notify_outdated_version:true,notify_new_admin:true,maintenance_mode:false,emergency_restrictions:false}

export async function GET(request:NextRequest){
 const auth=await requireOwner(request);if('error' in auth)return auth.error
 const {data,error}=await auth.service.from('owner_settings').select('settings,updated_at,updated_by').eq('id','global').maybeSingle()
 if(error)return NextResponse.json({error:error.message},{status:400})
 return NextResponse.json({ok:true,settings:{...defaults,...(data?.settings||{})},updated_at:data?.updated_at||null,updated_by:data?.updated_by||null})
}

export async function POST(request:NextRequest){
 const auth=await requireOwner(request);if('error' in auth)return auth.error
 const body=await request.json();const next={...defaults,...(body?.settings||{})}
 next.default_trial_days=Math.max(0,Number(next.default_trial_days)||0);next.default_grace_days=Math.max(0,Number(next.default_grace_days)||0);next.default_seats=Math.max(1,Number(next.default_seats)||1)
 const now=new Date().toISOString();const {error}=await auth.service.from('owner_settings').upsert({id:'global',settings:next,updated_by:auth.ownerEmail,updated_at:now},{onConflict:'id'})
 if(error)return NextResponse.json({error:error.message},{status:400})
 await auth.service.from('audit_logs').insert({organization_id:null,actor_email:auth.ownerEmail,action:'owner_update_settings',target_type:'owner_settings',target_id:'global',details:{changed:Object.keys(body?.settings||{})}})
 return NextResponse.json({ok:true,settings:next,updated_at:now,updated_by:auth.ownerEmail})
}
