const {reply,allowed,rpc,config,headers}=require('../lib/shared.cjs');
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function absoluteSignedUrl(value,origin){
 if(/^https:\/\//i.test(value))return value;
 const path=value.startsWith('/storage/v1/')?value:'/storage/v1/'+value.replace(/^\/+/, '');
 return origin+path;
}
exports.handler=async event=>{
 if(event.httpMethod!=='POST')return reply(405,{error:'Use POST'});
 try{
  if(!allowed(event))return reply(403,{error:'Open the order through the café website.'});
  if((event.body||'').length>3000)return reply(413,{error:'Invalid receipt request.'});
  const body=JSON.parse(event.body||'{}');
  if(!uuid.test(body.submission_id||''))return reply(400,{error:'Invalid receipt request.'});
  const authorization=event.headers.authorization||event.headers.Authorization||'';
  let path;
  if(authorization.startsWith('Bearer ')){
   path=await rpc('staff_payment_receipt_path',{p_submission_id:body.submission_id},authorization.slice(7));
  }else{
   if(!uuid.test(body.token||''))return reply(401,{error:'Use your private tracking link or sign in as staff.'});
   path=await rpc('customer_payment_receipt_path',{p_request_id:body.token,p_submission_id:body.submission_id});
  }
  const {url,key}=config();
  const response=await fetch(url+'/storage/v1/object/sign/payment-receipts/'+path,{method:'POST',headers:headers(key),body:JSON.stringify({expiresIn:120}),signal:AbortSignal.timeout(12000)});
  const signed=await response.json();
    if(!response.ok&&(response.status===400||response.status===404))return reply(404,{error:'This payment receipt is no longer available.'});
  if(!response.ok||!signed.signedURL)throw Error(signed.message||signed.error||'Could not sign receipt URL');
  const ext=path.split('.').pop().toLowerCase(),contentType=ext==='pdf'?'application/pdf':ext==='png'?'image/png':'image/jpeg';
  return reply(200,{url:absoluteSignedUrl(signed.signedURL,url),content_type:contentType,expires_in:120});
 }catch(error){
  if(error instanceof SyntaxError)return reply(400,{error:'Invalid receipt request.'});
  console.error('Payment receipt URL failed:',error.message);
  if(error.message.includes('Receipt not found'))return reply(404,{error:'This payment receipt is no longer available.'});
  if(error.message.includes('Staff access required'))return reply(403,{error:'Staff access is required to view this receipt.'});
  return reply(503,{error:'Could not open this receipt. Refresh and retry.'});
 }
};
