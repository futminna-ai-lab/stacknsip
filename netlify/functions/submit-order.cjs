const {reply}=require('../lib/shared.cjs');

exports.handler=async event=>{
 if(event.httpMethod!=='POST')return reply(405,{error:'Use POST'});
 return reply(410,{error:'Direct order submission is retired. Use the bank-transfer or Paystack checkout to submit your order.'});
};
