const {reply,allowed,rpc}=require('../lib/shared.cjs');
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
exports.handler=async event=>{
 if(event.httpMethod!=='POST')return reply(405,{error:'Use POST'});
 try{
  if(!allowed(event))return reply(403,{error:'Open the private order tracking page.'});
  if((event.body||'').length>1000)return reply(413,{error:'Invalid order receipt request.'});
  const {token}=JSON.parse(event.body||'{}');
  if(typeof token!=='string'||!uuid.test(token))return reply(400,{error:'Use your private tracking link to view this receipt.'});
  const order=await rpc('customer_order_receipt',{p_request_id:token});
  if(!order)return reply(404,{error:'Order not found. Check your private tracking link.'});
  return reply(200,{order});
 }catch(error){
  if(error instanceof SyntaxError)return reply(400,{error:'Invalid order receipt request.'});
  console.error('Customer order receipt failed:',error.message);
  return reply(503,{error:'Could not load the order receipt. Retry or contact the café.'});
 }
};
