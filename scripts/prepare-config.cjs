const fs=require('node:fs');
const saved=require('../connection.json');
const override=process.env.SUPABASE_URL||process.env.SUPABASE_PUBLISHABLE_KEY;
const url=override?process.env.SUPABASE_URL||'':saved.supabaseUrl,key=override?process.env.SUPABASE_PUBLISHABLE_KEY||'':saved.supabasePublishableKey;
if((url&&!key)||(!url&&key))throw Error('Set both SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY.');
if(key.startsWith('sb_secret_'))throw Error('The browser key must be publishable, never secret.');
if(key.startsWith('eyJ')){let payload;try{payload=JSON.parse(Buffer.from(key.split('.')[1],'base64url').toString());}catch{throw Error('Invalid browser key.');}if(payload.role!=='anon')throw Error('Only the legacy anon key may be used in the browser.');}
if(url){const parsed=new URL(url);if(parsed.protocol!=='https:'||parsed.username||parsed.password||parsed.pathname!=='/')throw Error('Use the HTTPS Supabase project origin.');}
fs.writeFileSync('public/assets/config.js','// Browser-safe connection settings. No server secret is bundled.\nwindow.STACK_CONFIG = '+JSON.stringify({supabaseUrl:url.replace(/\/$/,''),supabasePublishableKey:key})+';\n');
console.log(url?'Browser connection configured.':'Supabase is not connected yet; the setup notice remains visible.');
