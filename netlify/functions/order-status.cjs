const {reply,allowed,rpc}=require('../lib/shared.cjs');
exports.handler=async event=>{
 if(event.httpMethod!=='POST')return reply(405,{error:'Use POST'});
 try{
  if(!allowed(event))return reply(403,{error:'Open the café tracking page.'});
  if((event.body||'').length>1000)return reply(413,{error:'Invalid tracking link.'});
  const {token}=JSON.parse(event.body||'{}');
  if(typeof token!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(token))return reply(400,{error:'Use the private tracking link provided with your order.'});
  const saved=await rpc('track_order',{p_request_id:token});
  if(!saved)return reply(404,{error:'Order not found. Check the tracking link from your order confirmation.'});
  const order={};for(const field of ['reference','status','fulfillment','items','subtotal','delivery_fee','total','payment_status','created_at','updated_at'])order[field]=saved[field];
  return reply(200,{order});
 }catch(error){
  if(error instanceof SyntaxError)return reply(400,{error:'Invalid tracking link.'});
  return reply(503,{error:'Order tracking is temporarily unavailable. Retry or contact the café on WhatsApp.'});
 }
};
