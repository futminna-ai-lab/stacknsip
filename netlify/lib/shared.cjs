const {createHmac}=require('node:crypto');
function config(){const url=process.env.SUPABASE_URL||require('../../connection.json').supabaseUrl,key=process.env.SUPABASE_SECRET_KEY;if(!url||!key)throw Error('SETUP_REQUIRED');return {url:url.replace(/\/$/,''),key};}
function headers(key,token){return {'Content-Type':'application/json',apikey:key,...(token?{Authorization:'Bearer '+token}:key.startsWith('eyJ')?{Authorization:'Bearer '+key}:{})};}
function reply(statusCode,data){return {statusCode,headers:{'Content-Type':'application/json','Cache-Control':'no-store'},body:JSON.stringify(data)};}
function allowed(event){const origin=event.headers.origin;const host=event.headers['x-forwarded-host']||event.headers.host;try{return !!origin&&!!host&&new URL(origin).host===host;}catch{return false;}}
async function rpc(name,input,token){const {url,key}=config();const res=await fetch(url+'/rest/v1/rpc/'+name,{method:'POST',headers:headers(key,token),body:JSON.stringify(input),signal:AbortSignal.timeout(12000)});const data=await res.json();if(!res.ok)throw Error(data.message||'Request could not be completed');return data;}
function fingerprint(event){const {key}=config();const ip=event.headers['x-nf-client-connection-ip'];if(!ip)throw Error('NETWORK_REQUIRED');return createHmac('sha256',key).update(ip).digest('hex');}
module.exports={config,headers,reply,allowed,rpc,fingerprint};
