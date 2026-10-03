const {reply,allowed,rpc}=require('../lib/shared.cjs');
const paystack=require('../lib/paystack.cjs');
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
exports.handler=async event=>{
 if(event.httpMethod!=='POST')return reply(405,{error:'Use POST'});
 try{
  if(!allowed(event))return reply(403,{error:'Open checkout from the Stack & Sip website.'});
  if((event.body||'').length>1000)return reply(413,{error:'Invalid Paystack checkout request.'});
  const body=JSON.parse(event.body||'{}');
  if(!uuid.test(body.quote_id||''))return reply(400,{error:'Prepare a valid order quote first.'});
  const secretKey=paystack.secret();
  const publicKey=paystack.publicKey();
  if(secretKey.startsWith('sk_test_')!==publicKey.startsWith('pk_test_'))throw Error('PAYSTACK_MODE_MISMATCH');
  const reference=paystack.reference();
  const transaction=await rpc('start_paystack_transaction',{p_quote_id:body.quote_id,p_reference:reference});
  return reply(200,{reference:transaction.reference,email:transaction.email,amount_kobo:transaction.amount_kobo,public_key:publicKey});
 }catch(error){
  if(error instanceof SyntaxError)return reply(400,{error:'Invalid Paystack checkout request.'});
  console.error('Paystack initialization failed:',error.message);
  if(error.message==='PAYSTACK_MODE_MISMATCH')return reply(503,{error:'Paystack test/live keys do not match. Set both keys to the same mode in Netlify, then redeploy.'});
  const known=['Quote not found','expired','did not select Paystack','valid email','already submitted','already been received'];
  const safe=known.find(message=>error.message.toLowerCase().includes(message.toLowerCase()));
  return safe?reply(409,{error:error.message}):reply(503,{error:'Secure Paystack checkout could not be prepared. Please retry or choose bank transfer.'});
 }
};
