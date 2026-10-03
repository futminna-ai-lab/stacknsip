const {reply,allowed,rpc,config,headers}=require('../lib/shared.cjs');
const {validReceipt}=require('../lib/receipt.cjs');
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
exports.handler=async event=>{
 if(event.httpMethod!=='POST')return reply(405,{error:'Use POST'});
 try{
  if(!allowed(event))return reply(403,{error:'Open the private order tracking page.'});
  if((event.body||'').length>4000)return reply(413,{error:'Invalid payment submission.'});
  const body=JSON.parse(event.body||'{}');
  if(!uuid.test(body.token||'')||typeof body.path!=='string'||typeof body.payment_reference!=='string'||body.payment_reference.length>120)return reply(400,{error:'Check the receipt and payment reference.'});
  const order=await rpc('track_order',{p_request_id:body.token});
  if(!order)return reply(404,{error:'Order not found. Check your private tracking link.'});
  const escapedId=order.id.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const match=new RegExp('^'+escapedId+'/[0-9a-f-]{36}\\.(pdf|jpg|png|webp)$','i').exec(body.path);
  if(!match)return reply(400,{error:'Invalid receipt upload. Choose your file again.'});
  const {url,key}=config();
  const download=await fetch(url+'/storage/v1/object/authenticated/payment-receipts/'+body.path,{headers:headers(key),signal:AbortSignal.timeout(15000)});
  if(!download.ok)throw Error('Uploaded receipt could not be read from private storage');
  const bytes=Buffer.from(await download.arrayBuffer());
  if(bytes.length===0||bytes.length>5242880||!validReceipt(bytes,match[1].toLowerCase())){
  try{const removed=await fetch(url+'/storage/v1/object/payment-receipts/'+body.path,{method:'DELETE',headers:headers(key),signal:AbortSignal.timeout(12000)});if(!removed.ok)console.error('Invalid payment receipt cleanup failed:',removed.status);}catch(error){console.error('Invalid payment receipt cleanup failed:',error.message);}
   return reply(400,{error:'The uploaded file is not a valid PDF, JPG, PNG or WebP under 5 MB.'});
  }
  const saved=await rpc('submit_payment_receipt',{p_request_id:body.token,p_payment_reference:body.payment_reference.trim(),p_receipt_path:body.path});
  return reply(200,{submission:saved});
 }catch(error){
  if(error instanceof SyntaxError)return reply(400,{error:'Invalid payment submission.'});
  console.error('Payment receipt submission failed:',error.message);
    const expected=['Order not found','Bank transfer is unavailable','cannot accept another receipt','Invalid receipt path','Cancelled orders'];
  const safe=expected.find(message=>error.message.includes(message));
  return safe?reply(409,{error:error.message}):reply(503,{error:'We could not save your payment receipt. Please retry or contact the café.'});
 }
};
