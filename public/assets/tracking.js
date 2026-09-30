(() => {
 'use strict';
 const $=id=>document.getElementById(id),esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const money=n=>'₦'+Number(n).toLocaleString('en-NG'),date=t=>new Date(t).toLocaleString('en-NG',{timeZone:'Africa/Lagos',dateStyle:'medium',timeStyle:'short'});
 const steps=['pending','confirmed','preparing','ready','completed'];
 let token='',version=0,busy=false,terminal=false;
 const uuid=v=>/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
 function parse(value){value=value.trim();if(uuid(value))return value;try{const u=new URL(value,location.href);return new URLSearchParams(u.hash.slice(1)).get('token')||'';}catch{return '';}}
 function render(o){
  $('tracking-order').hidden=false;$('tracking-reference').textContent=o.reference;
  const labels={pending:'Pending',confirmed:'Confirmed',preparing:'Preparing',ready:o.fulfillment==='Pickup'?'Ready for pickup':'Ready for delivery',completed:'Completed',cancelled:'Cancelled'};
  const text={pending:'We received your order. The café is checking availability and the final total.',confirmed:'The café has confirmed your order.',preparing:'Your order is being prepared.',ready:o.fulfillment==='Pickup'?'Your order is ready to collect at Green Gardens, Wuse Zone 1, Abuja.':'Your order is ready for delivery. Contact the café for dispatch details.',completed:'Your order has been marked completed. Thank you for ordering from Stack & Sip!',cancelled:'This order has been cancelled. Contact the café if you need help.'};
  $('tracking-state').innerHTML=`<span class="tracking-status ${esc(o.status)}">${esc(labels[o.status]||'Status unavailable')}</span><p>${esc(text[o.status]||'Contact the café for an update.')}</p>`;
  const index=steps.indexOf(o.status);$('tracking-steps').hidden=o.status==='cancelled';$('tracking-steps').innerHTML=steps.map((s,i)=>`<li class="${i===index?'current':i<index?'done':''}"${i===index?' aria-current="step"':''}>${esc(labels[s])}</li>`).join('');
  $('tracking-fulfillment').textContent=o.fulfillment==='Pickup'?'Pickup · Green Gardens, Wuse Zone 1, Abuja':'Delivery · Abuja Municipal';
  $('tracking-items').innerHTML=o.items.map(i=>`<tr><td>${esc(i.name)}<small>${money(i.price)} each</small></td><td>${Number(i.quantity)}</td><td>${money(i.price*i.quantity)}</td></tr>`).join('');
  $('tracking-totals').innerHTML=`<div><dt>Menu subtotal</dt><dd>${money(o.subtotal)}</dd></div><div><dt>Delivery${o.status==='pending'?' estimate':''}</dt><dd>${money(o.delivery_fee)}</dd></div><div class="total"><dt>${o.status==='pending'?'Estimated total':'Order total'}</dt><dd>${money(o.total)}</dd></div>`;
  $('tracking-payment').textContent=o.payment_status==='paid'?'Payment recorded as paid by the café.':'Payment has not been recorded as paid. Contact the café for payment arrangements.';
  $('tracking-sync').textContent='Last café update: '+date(o.updated_at)+' (Lagos). Checked '+new Date().toLocaleTimeString('en-NG',{timeZone:'Africa/Lagos'})+'.';
  $('tracking-whatsapp').href='https://wa.me/2348161248972?text='+encodeURIComponent('Hello Stack & Sip, please help with my order '+o.reference+'. Its current status is '+o.status+'.');
  terminal=['completed','cancelled'].includes(o.status);
 }
 async function refresh(){
  if(busy||!token)return;busy=true;const current=version;$('refresh-tracking').disabled=true;
  try{const r=await fetch('/.netlify/functions/order-status',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token}),cache:'no-store',signal:AbortSignal.timeout(12000)});let data;try{data=await r.json();}catch{throw Error('Order tracking is unavailable on this host. Contact the café on WhatsApp.');}if(!r.ok)throw Error(data.error||'Unable to load your order.');if(current!==version)return;render(data.order);$('tracking-feedback').textContent='';}
  catch(error){if(current===version)$('tracking-feedback').textContent=error.name==='TimeoutError'?'Tracking timed out. Please retry.':error.message;}
  finally{busy=false;$('refresh-tracking').disabled=false;if(current!==version)refresh();}
 }
 function open(value){const next=parse(value);if(!uuid(next)){$('tracking-feedback').textContent='Paste the private tracking link provided after submitting your order.';return;}token=next;version++;terminal=false;$('tracking-order').hidden=true;$('tracking-feedback').textContent='Checking your order…';history.replaceState(null,'',location.pathname+'#token='+token);$('tracking-link').value=location.href;refresh();}
 $('tracking-form').addEventListener('submit',e=>{e.preventDefault();open($('tracking-link').value);});$('refresh-tracking').addEventListener('click',refresh);
 setInterval(()=>{if(!document.hidden&&!terminal)refresh();},15000);document.addEventListener('visibilitychange',()=>{if(!document.hidden&&!terminal)refresh();});
 const initial=new URLSearchParams(location.hash.slice(1)).get('token');if(initial)open(initial);
})();
