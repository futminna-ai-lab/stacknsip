const assert=require('node:assert/strict');
const {createHmac,randomUUID}=require('node:crypto');
const initialize=require('../netlify/functions/initialize-paystack-payment.cjs').handler;
const verify=require('../netlify/functions/verify-paystack-payment.cjs').handler;
const webhook=require('../netlify/functions/paystack-webhook.cjs').handler;

const quoteId=randomUUID(),reference='SS-'+randomUUID();
const event={httpMethod:'POST',headers:{host:'example.netlify.app',origin:'https://example.netlify.app'},body:''};
process.env.SUPABASE_URL='https://project.example.test';
process.env.SUPABASE_SECRET_KEY='sb_secret_TEST_NOT_A_REAL_KEY';
process.env.PAYSTACK_PUBLIC_KEY='pk_test_public_key';
process.env.PAYSTACK_SECRET_KEY='sk_test_private_key';

(async()=>{
 let created;
 global.fetch=async(url,options)=>{
  assert.ok(String(url).endsWith('/rpc/start_paystack_transaction'));
  created=JSON.parse(options.body);
  return {ok:true,json:async()=>({reference:created.p_reference,email:'customer@example.test',amount_kobo:2300000})};
 };
 const initialized=await initialize({...event,body:JSON.stringify({quote_id:quoteId})});
 assert.equal(initialized.statusCode,200);
 const initialization=JSON.parse(initialized.body);
 assert.equal(initialization.email,'customer@example.test');
 assert.equal(initialization.amount_kobo,2300000);
 assert.equal(initialization.public_key,'pk_test_public_key');
 assert.equal(created.p_quote_id,quoteId);
 assert.equal(created.p_reference,initialization.reference);
 assert.ok(!initialized.body.includes(process.env.PAYSTACK_SECRET_KEY));
 assert.equal((await initialize({...event,headers:{...event.headers,origin:'https://attacker.test'},body:JSON.stringify({quote_id:quoteId})})).statusCode,403);
 process.env.PAYSTACK_PUBLIC_KEY='pk_live_public_key';
 assert.match(JSON.parse((await initialize({...event,body:JSON.stringify({quote_id:quoteId})})).body).error,/test\/live keys do not match/i);
 process.env.PAYSTACK_PUBLIC_KEY='pk_test_public_key';

 const completed=[];
 global.fetch=async(url,options)=>{
  url=String(url);
  if(url.includes('api.paystack.co/transaction/verify/')){
   assert.match(options.headers.Authorization,/^Bearer sk_test_private_key$/);
   return {ok:true,json:async()=>({status:true,data:{reference,status:'success',amount:2300000,currency:'NGN',id:123456}})};
  }
  if(url.endsWith('/rpc/complete_paystack_transaction')){
   completed.push(JSON.parse(options.body));
   return {ok:true,json:async()=>({status:'paid',reference:'SS-ORDER',tracking_token:quoteId,total:23000})};
  }
  throw Error('Unexpected Paystack API request '+url);
 };
 const verified=await verify({...event,body:JSON.stringify({reference})});
 assert.equal(verified.statusCode,200);
 assert.equal(JSON.parse(verified.body).payment.status,'paid');
 assert.equal(completed.length,1);
 assert.equal(completed[0].p_amount_kobo,2300000);
 assert.equal(completed[0].p_currency,'NGN');
 assert.equal((await verify({...event,body:JSON.stringify({reference:'SS-not-issued'})})).statusCode,400);

 const payload=JSON.stringify({event:'charge.success',data:{reference}});
 const signature=createHmac('sha512',process.env.PAYSTACK_SECRET_KEY).update(payload).digest('hex');
 assert.equal((await webhook({...event,headers:{...event.headers,'x-paystack-signature':'0'.repeat(128)},body:payload})).statusCode,401);
 const received=await webhook({...event,headers:{...event.headers,'x-paystack-signature':signature},body:payload});
 assert.equal(received.statusCode,200);
 assert.deepEqual(JSON.parse(received.body),{received:true});
 assert.equal(completed.length,2);
 console.log('PASS: quote-bound Paystack initialization, public/secret key separation, server-side amount verification, and signed webhook handling.');
})().catch(error=>{console.error(error);process.exitCode=1;});
