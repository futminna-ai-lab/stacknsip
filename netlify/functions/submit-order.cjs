const {reply,allowed,rpc,fingerprint}=require('../lib/shared.cjs');
exports.handler=async event=>{
 if(event.httpMethod!=='POST')return reply(405,{error:'Use POST'});
 try{
  if(!allowed(event))return reply(403,{error:'Open checkout from the café website.'});
  if((event.body||'').length>30000)return reply(413,{error:'Order is too large.'});
  const body=JSON.parse(event.body||'{}');
  if(body.website)return reply(400,{error:'Invalid order request'}); // honeypot
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.request_id||''))return reply(400,{error:'Prepare your order card again.'});
  if(!Array.isArray(body.items)||!body.items.length||body.items.length>50||body.items.some(i=>typeof i.id!=='string'||!Number.isInteger(i.quantity)||i.quantity<1||i.quantity>99))return reply(400,{error:'Check your cart items and quantities.'});
  const c=body.customer||{};
  if(typeof c.name!=='string'||!c.name.trim()||c.name.length>80||typeof c.phone!=='string'||!/^[+0-9() .-]{7,30}$/.test(c.phone)||!['Pickup','Delivery'].includes(c.fulfillment)||typeof c.address!=='string'||c.address.length>300||typeof c.notes!=='string'||c.notes.length>500)return reply(400,{error:'Check your customer details.'});
  const saved=await rpc('submit_order',{p_request_id:body.request_id,p_customer:c,p_items:body.items.map(i=>({id:i.id,quantity:i.quantity})),p_fingerprint:fingerprint(event)});
  return reply(200,{order:{...saved,tracking_token:body.request_id}});
 }catch(error){
  if(error.message==='SETUP_REQUIRED')return reply(503,{error:'Online order submission is not connected yet. Please use WhatsApp.'});
  if(error instanceof SyntaxError)return reply(400,{error:'Invalid order request'});
  const safe=['Check your customer details','Choose between','Too many order','Online orders are paused','An item is unavailable','Duplicate items','Order exceeds','Order details changed','Invalid quantity'];
  if(safe.some(s=>error.message.startsWith(s)))return reply(409,{error:error.message});
  console.error('Order submission failed:',error.name);return reply(503,{error:'We could not save the order. Your details are still here; retry or use WhatsApp.'});
 }
};
