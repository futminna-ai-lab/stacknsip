const {reply,allowed,rpc,config,headers}=require('../lib/shared.cjs');
exports.handler=async event=>{
 if(event.httpMethod!=='POST')return reply(405,{error:'Use POST'});
 try{
  if(!allowed(event))return reply(403,{error:'Use the staff dashboard.'});
  const token=(event.headers.authorization||'').replace(/^Bearer /,'');if(!token)return reply(401,{error:'Sign in again.'});
  if(!await rpc('is_owner',{},token))return reply(403,{error:'Owner access required.'});
  const {email}=JSON.parse(event.body||'{}');if(typeof email!=='string'||email.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return reply(400,{error:'Enter a valid staff email.'});
  await rpc('set_staff',{p_email:email.toLowerCase().trim(),p_active:true},token);
  const {url,key}=config();const origin=event.headers.origin;
  const response=await fetch(url+'/auth/v1/invite?redirect_to='+encodeURIComponent(origin+'/admin.html'),{method:'POST',headers:headers(key),body:JSON.stringify({email:email.toLowerCase().trim()}),signal:AbortSignal.timeout(12000)});
  if(!response.ok){const info=await response.json();if(['email_exists','user_already_exists'].includes(info.code))return reply(200,{message:'Staff access granted. This account already exists; they can sign in or reset their password.'});return reply(502,{error:'Staff access was granted, but the invitation email failed. Resend it from Supabase Authentication → Users.'});}
  return reply(200,{message:'Staff invitation sent. They must use the email link to set their password.'});
 }catch(error){if(error.message==='SETUP_REQUIRED')return reply(503,{error:'Configure the server connection first.'});console.error('Staff invitation failed:',error.name);return reply(503,{error:'Invitation could not be completed. Check staff access and retry.'});}
};
