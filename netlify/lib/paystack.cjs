const {timingSafeEqual,createHmac,randomUUID}=require('node:crypto');
const {rpc}=require('./shared.cjs');

function secret(){
 const value=process.env.PAYSTACK_SECRET_KEY;
 if(!value||!/^sk_(test|live)_/.test(value))throw Error('PAYSTACK_SETUP_REQUIRED');
 return value;
}
function publicKey(){
 const value=process.env.PAYSTACK_PUBLIC_KEY;
 if(!value||!/^pk_(test|live)_/.test(value))throw Error('PAYSTACK_SETUP_REQUIRED');
 return value;
}
function isValidSignature(rawBody,signature){
 if(typeof signature!=='string'||!/^[a-f0-9]{128}$/i.test(signature))return false;
 const expected=createHmac('sha512',secret()).update(rawBody).digest();
 const supplied=Buffer.from(signature,'hex');
 return supplied.length===expected.length&&timingSafeEqual(supplied,expected);
}
async function verify(reference){
 const response=await fetch('https://api.paystack.co/transaction/verify/'+encodeURIComponent(reference),{
  headers:{Authorization:'Bearer '+secret()},
  signal:AbortSignal.timeout(15000)
 });
 const result=await response.json();
 if(!response.ok||result.status!==true||!result.data)throw Error('Paystack transaction verification failed');
 if(result.data.reference!==reference)throw Error('Paystack returned a different transaction reference');
 return result.data;
}
async function complete(reference){
 const data=await verify(reference);
 return rpc('complete_paystack_transaction',{
  p_reference:reference,
  p_gateway_status:data.status,
  p_amount_kobo:data.amount,
  p_currency:data.currency,
  p_gateway_id:String(data.id||'')
 });
}
function reference(){return 'SS-'+randomUUID();}
module.exports={secret,publicKey,isValidSignature,complete,reference};
