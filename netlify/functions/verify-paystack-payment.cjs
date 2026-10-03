const {reply,allowed}=require('../lib/shared.cjs');
const paystack=require('../lib/paystack.cjs');
exports.handler=async event=>{
 if(event.httpMethod!=='POST')return reply(405,{error:'Use POST'});
 try{
  if(!allowed(event))return reply(403,{error:'Open checkout from the Stack & Sip website.'});
  if((event.body||'').length>1000)return reply(413,{error:'Invalid Paystack verification request.'});
  const body=JSON.parse(event.body||'{}');
  if(typeof body.reference!=='string'||!/^SS-[A-Fa-f0-9-]{36}$/.test(body.reference))return reply(400,{error:'Invalid Paystack reference.'});
  const result=await paystack.complete(body.reference);
  return reply(200,{payment:result});
 }catch(error){
  if(error instanceof SyntaxError)return reply(400,{error:'Invalid Paystack verification request.'});
  console.error('Paystack verification endpoint failed:',error.message);
  if(error.message.includes('PAYSTACK_SETUP_REQUIRED'))return reply(503,{error:'Paystack is not configured. Choose bank transfer or contact the café.'});
  return reply(503,{error:'We could not confirm this payment yet. Do not pay again; retry verification shortly.'});
 }
};
