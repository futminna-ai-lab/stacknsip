const {randomUUID}=require('node:crypto');
const {reply,allowed,rpc,config,headers}=require('../lib/shared.cjs');
const {fileTypes}=require('../lib/receipt.cjs');
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
exports.handler=async event=>{
 if(event.httpMethod!=='POST')return reply(405,{error:'Use POST'});
 try{
  if(!allowed(event))return reply(403,{error:'Open checkout from the Stack & Sip website.'});
  if((event.body||'').length>3000)return reply(413,{error:'Invalid receipt upload.'});
  const body=JSON.parse(event.body||'{}');
  if(!uuid.test(body.quote_id||'')||!fileTypes[body.content_type])return reply(400,{error:'Choose a PDF, JPG, PNG or WebP receipt.'});
  const path=body.quote_id+'/'+randomUUID()+'.'+fileTypes[body.content_type];
  const issued=await rpc('issue_quote_upload',{p_quote_id:body.quote_id,p_path:path,p_file_type:body.content_type});
  const {url,key}=config();
  for(const replacedPath of issued.replaced_paths||[]){
   const removed=await fetch(url+'/storage/v1/object/payment-receipts/'+replacedPath,{method:'DELETE',headers:headers(key),signal:AbortSignal.timeout(12000)});
   if(!removed.ok)console.error('Replaced quote receipt cleanup failed:',removed.status);
  }
  const response=await fetch(url+'/storage/v1/object/upload/sign/payment-receipts/'+path,{method:'POST',headers:headers(key),body:JSON.stringify({upsert:false}),signal:AbortSignal.timeout(12000)});
  const signed=await response.json();
  if(!response.ok||!signed.token)throw Error(signed.message||signed.error||'Could not prepare a private receipt upload');
  return reply(200,{path,token:signed.token});
 }catch(error){
  if(error instanceof SyntaxError)return reply(400,{error:'Invalid receipt upload.'});
  console.error('Quote upload URL failed:',error.message);
  const safe=['Quote not found','already submitted','expired','Invalid receipt upload','Receipt evidence is already retained'].find(message=>error.message.toLowerCase().includes(message.toLowerCase()));
  return safe?reply(409,{error:error.message}):reply(503,{error:'Could not prepare your private receipt upload. Please retry.'});
 }
};
