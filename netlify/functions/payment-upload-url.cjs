const {randomUUID}=require('node:crypto');
const {reply,allowed,rpc,config,headers}=require('../lib/shared.cjs');
const {fileTypes}=require('../lib/receipt.cjs');
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
exports.handler=async event=>{
 if(event.httpMethod!=='POST')return reply(405,{error:'Use POST'});
 try{
  if(!allowed(event))return reply(403,{error:'Open the private order tracking page.'});
  if((event.body||'').length>3000)return reply(413,{error:'Invalid upload request.'});
  const body=JSON.parse(event.body||'{}');
  if(!uuid.test(body.token||'')||!fileTypes[body.content_type])return reply(400,{error:'Choose a PDF, JPG, PNG or WebP receipt.'});
  const order=await rpc('track_order',{p_request_id:body.token});
  if(!order)return reply(404,{error:'Order not found. Check your private tracking link.'});
  if(order.payment_status!=='unpaid'&&order.payment_status!=='rejected')return reply(409,{error:'This order is not accepting another receipt.'});
    if(order.status==='cancelled')return reply(409,{error:'Cancelled orders cannot accept payment receipts.'});
  if(!order.bank_name||!order.account_name||!order.account_number)return reply(409,{error:'Bank-transfer details are not configured yet. Contact the café.'});
  const path=order.id+'/'+randomUUID()+'.'+fileTypes[body.content_type];
  const {url,key}=config();
  const response=await fetch(url+'/storage/v1/object/upload/sign/payment-receipts/'+path,{method:'POST',headers:headers(key),body:JSON.stringify({upsert:false}),signal:AbortSignal.timeout(12000)});
  const signed=await response.json();
  if(!response.ok||!signed.token)throw Error(signed.message||signed.error||'Could not prepare a private receipt upload');
  return reply(200,{path,token:signed.token});
 }catch(error){
  if(error instanceof SyntaxError)return reply(400,{error:'Invalid upload request.'});
  console.error('Payment upload URL failed:',error.message);
  return reply(503,{error:'Could not prepare your receipt upload. Please retry.'});
 }
};
