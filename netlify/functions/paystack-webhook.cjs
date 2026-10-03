const {reply}=require('../lib/shared.cjs');
const paystack=require('../lib/paystack.cjs');
exports.handler=async event=>{
 if(event.httpMethod!=='POST')return reply(405,{error:'Use POST'});
 try{
  const raw=event.isBase64Encoded?Buffer.from(event.body||'','base64'):Buffer.from(event.body||'','utf8');
  const signature=event.headers['x-paystack-signature']||event.headers['X-Paystack-Signature'];
  if(!paystack.isValidSignature(raw,signature))return reply(401,{error:'Invalid webhook signature'});
  const payload=JSON.parse(raw.toString('utf8'));
  if(payload.event!=='charge.success')return reply(200,{received:true});
  const reference=payload.data?.reference;
  if(typeof reference!=='string'||!/^SS-[A-Fa-f0-9-]{36}$/.test(reference))return reply(200,{received:true});
  await paystack.complete(reference);
  return reply(200,{received:true});
 }catch(error){
  if(error instanceof SyntaxError)return reply(400,{error:'Invalid webhook payload'});
  console.error('Paystack webhook processing failed:',error.message);
  return reply(503,{error:'Webhook processing failed; Paystack may retry.'});
 }
};
