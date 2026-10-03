const {reply,allowed,rpc,config,headers}=require('../lib/shared.cjs');
const {fileTypes,validReceipt}=require('../lib/receipt.cjs');
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
exports.handler=async event=>{
 if(event.httpMethod!=='POST')return reply(405,{error:'Use POST'});
 try{
  if(!allowed(event))return reply(403,{error:'Open checkout from the Stack & Sip website.'});
  if((event.body||'').length>4000)return reply(413,{error:'Invalid receipt submission.'});
  const body=JSON.parse(event.body||'{}');
  if(!uuid.test(body.quote_id||'')||typeof body.path!=='string')return reply(400,{error:'Check the uploaded receipt and choose it again.'});
  const match=new RegExp('^'+body.quote_id.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'/[0-9a-f-]{36}\\.(pdf|jpg|png|webp)$','i').exec(body.path);
  if(!match)return reply(400,{error:'Invalid receipt upload. Choose your file again.'});
  const intent=await rpc('validate_quote_receipt_upload',{p_quote_id:body.quote_id,p_path:body.path});
  if(fileTypes[intent.file_type]!==match[1].toLowerCase())return reply(400,{error:'The receipt type does not match its private upload. Choose it again.'});
  const {url,key}=config();
  const download=await fetch(url+'/storage/v1/object/authenticated/payment-receipts/'+body.path,{headers:headers(key),signal:AbortSignal.timeout(15000)});
  if(!download.ok)throw Error('Uploaded receipt could not be read from private storage');
  const bytes=Buffer.from(await download.arrayBuffer());
  if(bytes.length===0||bytes.length>5242880||!validReceipt(bytes,match[1].toLowerCase())){
   const removed=await fetch(url+'/storage/v1/object/payment-receipts/'+body.path,{method:'DELETE',headers:headers(key),signal:AbortSignal.timeout(12000)});
   if(!removed.ok)console.error('Invalid quote receipt cleanup failed:',removed.status);
   return reply(400,{error:'The uploaded file is not a valid PDF, JPG, PNG or WebP under 5 MB.'});
  }
  return reply(200,{validated:true,quote_expired:intent.quote_expired===true});
 }catch(error){
  if(error instanceof SyntaxError)return reply(400,{error:'Invalid receipt submission.'});
  console.error('Quote receipt validation failed:',error.message);
  const safe=['Quote not found','already submitted','Receipt upload was replaced','Receipt upload was not issued'].find(message=>error.message.toLowerCase().includes(message.toLowerCase()));
  return safe?reply(409,{error:error.message}):reply(503,{error:'We could not validate the receipt. Please upload it again.'});
 }
};
