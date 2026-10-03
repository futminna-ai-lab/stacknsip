const {reply}=require('../lib/shared.cjs');
exports.handler=async event=>event.httpMethod==='POST'
 ?reply(410,{error:'Direct order submission is disabled. Create a current quote, upload payment evidence and place the order through checkout.'})
 :reply(405,{error:'Use POST'});
