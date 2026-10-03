const {randomUUID}=require('node:crypto');
const {reply,allowed,rpc,fingerprint}=require('../lib/shared.cjs');
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
exports.handler=async event=>{
 if(event.httpMethod!=='POST')return reply(405,{error:'Use POST'});
 try{
  if(!allowed(event))return reply(403,{error:'Open checkout from the Stack & Sip website.'});
  if((event.body||'').length>40000)return reply(413,{error:'The cart is too large.'});
  const body=JSON.parse(event.body||'{}');
  if(body.website)return reply(200,{quote_id:body.quote_id||randomUUID(),bot_blocked:true});
  const quoteId=body.quote_id||randomUUID();
  if(!uuid.test(quoteId)||!body.customer||!Array.isArray(body.items))return reply(400,{error:'Check your customer details and cart.'});
  const quote=await rpc('create_order_quote',{p_quote_id:quoteId,p_customer:body.customer,p_items:body.items,p_fingerprint:fingerprint(event)});
  return reply(200,{quote});
 }catch(error){
  if(error instanceof SyntaxError)return reply(400,{error:'Invalid quote request.'});
  console.error('Order quote failed:',error.message);
  const known=['Check your customer details','Choose between','Invalid offer','required number of paid','Duplicate','unavailable','sold out','no longer','have changed','no add-on price','Online ordering is paused','payment instructions are not configured','Bank-transfer details are not configured','This quote has expired','already used','extra has no price','Order exceeds the online limit'];
  const safe=known.find(message=>error.message.toLowerCase().includes(message.toLowerCase()));
  return safe?reply(409,{error:error.message}):reply(503,{error:'We could not prepare a price quote. Refresh the menu and retry.'});
 }
};
