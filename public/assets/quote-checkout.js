(() => {
 'use strict';
 const form=document.getElementById('order-form'),output=document.getElementById('order-result'),status=document.getElementById('order-status');
 if(!form||!output)return;
 const config=window.STACK_CONFIG||{},money=n=>'₦'+Number(n).toLocaleString('en-NG'),esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const checkoutDialog=document.getElementById('order-checkout'),checkoutTitle=document.getElementById('checkout-title'),checkoutDescription=document.getElementById('checkout-description');
 let quote=null,busy=false,timer=null,uploadedReceiptPath=null,paystackCheckout=null,paystackPreparePromise=null;
 async function responseData(response,functionName){
  let data;
  try{
   const body=typeof response.text==='function'?await response.text():null;
   data=body!==null?(body.trim()?JSON.parse(body):null):await response.json();
  }catch{
   const unavailable=response.status===404||response.status===405||response.status===0;
   throw Error(unavailable
    ?`The Netlify function "${functionName}" could not handle this request (HTTP ${response.status}). VS Code Live Server cannot run Netlify Functions; open the deployed Netlify site or run the project with Netlify Dev.`
    :`The Netlify function "${functionName}" returned an empty or invalid response (HTTP ${response.status}). Check its Netlify function logs and retry.`);
  }
  if(data===null){
   const unavailable=response.status===404||response.status===405||response.status===0;
   throw Error(unavailable
    ?`The Netlify function "${functionName}" could not handle this request (HTTP ${response.status}). VS Code Live Server cannot run Netlify Functions; open the deployed Netlify site or run the project with Netlify Dev.`
    :`The Netlify function "${functionName}" returned an empty response (HTTP ${response.status}). Check its Netlify function logs and retry.`);
  }
  return data;
 }
 const formFields=()=>Array.from(form.querySelectorAll('input:not([name="website"]),textarea,select,button[type="submit"]'));
 function toggleForm(disabled){for(const field of formFields())field.disabled=disabled;}
 function formatTime(value){return new Date(value).toLocaleString('en-NG',{timeZone:'Africa/Lagos',dateStyle:'medium',timeStyle:'short'});}
 function itemRows(items){return items.map(item=>`<li><strong>${esc(item.quantity)} × ${esc(item.name)}</strong><span>${money(item.base_price)} base + ${money(item.option_total)} extras = ${money(item.price)} each · ${money(item.price)} × ${esc(item.quantity)} = ${money(item.line_total)}</span>${item.extras?.length?`<small>${item.extras.map(option=>`${esc(option.group)}: ${esc(option.name)} (${option.included?'included in offer price':'+'+money(option.price)})`).join(' · ')}</small>`:''}</li>`).join('');}
 function showQuote(data){
  quote=data;uploadedReceiptPath=null;toggleForm(true);form.hidden=true;
  if(checkoutTitle)checkoutTitle.textContent='Payment quote';
  if(checkoutDescription)checkoutDescription.hidden=true;
  const paystack=data.payment_method==='paystack';
  const transferDetails=`<section id="quote-bank-transfer" class="transfer-instructions"><h3>Bank transfer</h3><dl><div><dt>Bank</dt><dd>${esc(data.bank_name)}</dd></div><div><dt>Account name</dt><dd>${esc(data.account_name)}</dd></div><div><dt>Account number</dt><dd>${esc(data.account_number)}</dd></div><div><dt>Amount</dt><dd>${money(data.total)}</dd></div></dl><p>Transfer the exact quoted amount. Your order is not sent to staff until you upload the receipt and place the order.</p><p>${esc(data.payment_instructions).replace(/\r?\n/g,'<br>')}</p></section><p data-expired-quote-warning hidden>This quote expired. Do not pay using its amount. If you already paid, upload the receipt below so the café can review it; the expired quote will not create an order or silently reprice your payment.</p><form id="quote-receipt-form"><label>Payment receipt (PDF, JPG, PNG or WebP; maximum 5 MB)<input name="receipt" type="file" accept="application/pdf,image/jpeg,image/png,image/webp" required></label><label>Payment reference (optional)<input name="payment_reference" maxlength="120"></label><button class="button secondary" type="button" data-upload-receipt>Upload receipt</button><button class="button secondary" type="submit" data-place-order disabled>Place order</button><p id="quote-receipt-status" role="status"></p></form>`;
  const paystackDetails=`<section id="quote-payment-section" class="transfer-instructions"><h3>Pay securely online</h3><p>Pay <strong>${money(data.total)}</strong> using the options available in Paystack: card, bank transfer, USSD, or wallet.</p><p>Your order is confirmed only after Paystack verifies payment.</p><button type="button" class="button secondary" data-paystack-checkout>Make payment</button><p id="paystack-checkout-status" role="status"></p></section><p data-expired-quote-warning hidden>This quote expired before payment. Start a new quote and check the amount before paying.</p>`;
  output.hidden=false;output.innerHTML=`<p>Quote ID: <strong>${esc(data.quote_id)}</strong></p><p>Valid until <strong>${esc(formatTime(data.expires_at))}</strong> (Africa/Lagos). The quoted prices are locked until then. <span data-quote-countdown></span></p><ul class="quote-items">${itemRows(data.items)}</ul><dl class="quote-totals"><div><dt>Items</dt><dd>${money(data.subtotal)}</dd></div><div><dt>${data.delivery_fee?'Delivery charge':'Pickup'}</dt><dd>${money(data.delivery_fee)}</dd></div><div><dt>Amount to pay</dt><dd><strong>${money(data.total)}</strong></dd></div></dl>${paystack?paystackDetails:transferDetails}<button class="text-button" type="button" data-reset-quote>Start a new quote</button>`;
  window.StackReceipt?.openCheckout?.();
  startCountdown();
  if(paystack)preparePaystack();
 }
 function startCountdown(){
  clearInterval(timer);
  const update=()=>{if(!quote)return;const left=new Date(quote.expires_at).getTime()-Date.now(),expired=left<=0,node=output.querySelector('[data-quote-countdown]');if(node)node.textContent=expired?'Expired — do not pay at this price.':Math.ceil(left/60000)+' min remaining';const bank=output.querySelector('#quote-bank-transfer'),section=output.querySelector('#quote-payment-section'),warning=output.querySelector('[data-expired-quote-warning]'),submit=output.querySelector('[data-place-order]'),payButton=output.querySelector('[data-paystack-checkout]');if(bank)bank.hidden=expired;if(warning)warning.hidden=!expired;if(submit)submit.textContent=expired?'Send receipt for café review':'Place order';if(payButton)payButton.disabled=expired||!paystackCheckout;if(section&&expired)section.hidden=true;};
  update();timer=setInterval(update,1000);
 }
 function payloadItems(){
  const items=window.StackReceipt?.getItems?.()||[];
  if(!items.length)throw Error('Your cart is empty. Add items before checkout.');
  const unavailable=items.find(item=>!item.available);
  if(unavailable){
   const choice=unavailable.extras?.find(option=>!option.available);
   throw Error(choice?`${choice.group}: ${choice.name} is unavailable for ${unavailable.name}. Remove or replace that choice.`:`${unavailable.name} is sold out. Remove it from your cart or choose another offer.`);
  }
  return items.map(item=>({id:item.id,quantity:item.quantity,options:item.options||[]}));
 }
 async function createQuote(event){
  event.preventDefault();if(busy||!form.reportValidity())return;
  if(!window.StackBackend?.configured){status.textContent='Online checkout is not configured. Please contact the café.';return;}
  const paymentMethod=form.querySelector('[name="payment_method"]:checked')?.value||'bank_transfer',email=form.elements.email.value.trim();
  const customer={name:form.elements.name.value.trim(),phone:form.elements.phone.value.trim(),email,payment_method:paymentMethod,fulfillment:form.elements.fulfillment.value,address:form.elements.address.value.trim(),notes:form.elements.notes.value.trim()};
  if(!customer.name||!customer.phone||(customer.fulfillment==='Delivery'&&!customer.address)||(paymentMethod==='paystack'&&!email)){status.textContent='Enter your name, phone, delivery address if needed, and email for Paystack.';return;}
  busy=true;const button=form.querySelector('[type="submit"]');button.disabled=true;status.textContent=paymentMethod==='paystack'?'Checking item availability and preparing secure Paystack checkout…':'Checking item availability and preparing your bank-transfer quote…';
  try{
   if(window.StackShop?.reloadMenu){const menu=await window.StackShop.reloadMenu();if(menu.optionsAvailable===false)throw Error('Online ordering is unavailable until the database menu-option migrations are applied. Please contact the café.');}
   else if(window.StackBackend?.reloadMenu){const menu=await window.StackBackend.reloadMenu();if(menu.optionsAvailable===false)throw Error('Online ordering is unavailable until the database menu-option migrations are applied. Please contact the café.');}
   else if(window.StackBackend?.getMenu){const menu=await window.StackBackend.getMenu();if(menu.optionsAvailable===false)throw Error('Online ordering is unavailable until the database menu-option migrations are applied. Please contact the café.');}
   const response=await fetch('/.netlify/functions/create-order-quote',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({quote_id:crypto.randomUUID(),website:form.elements.website?.value||'',customer,items:payloadItems()})});
   const data=await responseData(response,'create-order-quote');if(!response.ok)throw Error(data?.error||'Could not prepare your quote.');
   if(!data)throw Error('The quote service returned an empty response. Check the Netlify function logs and retry.');
   if(data.bot_blocked)return;
   showQuote(data.quote);
  }catch(error){status.textContent=error.message||'Could not prepare your quote. Please retry.';}
  finally{busy=false;button.disabled=false;}
 }
 async function uploadReceipt(){
  if(busy||!quote)return;
  const receiptForm=output.querySelector('#quote-receipt-form'),file=receiptForm.elements.receipt.files[0],feedback=receiptForm.querySelector('#quote-receipt-status'),upload=receiptForm.querySelector('[data-upload-receipt]'),place=receiptForm.querySelector('[data-place-order]');
  if(!file||!['application/pdf','image/jpeg','image/png','image/webp'].includes(file.type)||file.size===0||file.size>5242880){feedback.textContent='Choose a valid PDF, JPG, PNG or WebP receipt no larger than 5 MB.';return;}
  busy=true;upload.disabled=true;place.disabled=true;receiptForm.elements.receipt.disabled=true;feedback.textContent='Preparing a private receipt upload…';
  try{
   const prepared=await fetch('/.netlify/functions/quote-upload-url',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({quote_id:quote.quote_id,content_type:file.type})});
   const signed=await responseData(prepared,'quote-upload-url');if(!prepared.ok)throw Error(signed?.error||'Could not prepare receipt upload.');
   if(!signed)throw Error('The receipt upload service returned an empty response. Check Netlify function logs and retry.');
   const storage=await fetch(config.supabaseUrl.replace(/\/$/,'')+'/storage/v1/object/upload/sign/payment-receipts/'+signed.path+'?token='+encodeURIComponent(signed.token),{method:'PUT',headers:{apikey:config.supabasePublishableKey,'Content-Type':file.type},body:file});
   if(!storage.ok)throw Error('The private upload did not complete. Retry with the same quote.');
   feedback.textContent='Receipt uploaded privately. Checking the file…';
   const checked=await fetch('/.netlify/functions/quote-validate-receipt',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({quote_id:quote.quote_id,path:signed.path})});
   const validation=await responseData(checked,'quote-validate-receipt');if(!checked.ok)throw Error(validation?.error||'The receipt could not be validated.');
   if(!validation)throw Error('The receipt validation service returned an empty response. Check Netlify function logs and retry.');
   uploadedReceiptPath=signed.path;place.disabled=false;
   feedback.textContent=validation.quote_expired?'Receipt checked. The quote has expired; send it for café review. No order will be created.':'Receipt checked and uploaded privately. You can place the order now, or choose another file to replace this receipt.';
  }catch(error){feedback.textContent=error.message||'Could not upload this receipt. Please retry.';}
  finally{busy=false;if(quote&&upload){upload.disabled=false;receiptForm.elements.receipt.disabled=false;}}
 }
 async function placeOrder(event){
  event.preventDefault();if(busy||!quote)return;
  const receiptForm=event.target,feedback=receiptForm.querySelector('#quote-receipt-status'),submit=receiptForm.querySelector('[data-place-order]');
  if(!uploadedReceiptPath){feedback.textContent='Upload and validate your receipt before placing the order.';submit.disabled=true;return;}
  busy=true;submit.disabled=true;receiptForm.elements.receipt.disabled=true;receiptForm.elements.payment_reference.disabled=true;feedback.textContent='Submitting your order securely…';
  try{
   const placed=await fetch('/.netlify/functions/place-quoted-order',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({quote_id:quote.quote_id,path:uploadedReceiptPath,payment_reference:receiptForm.elements.payment_reference.value.trim()})});
   const saved=await responseData(placed,'place-quoted-order');
   if(!placed.ok&&saved?.receipt_retained){
    clearInterval(timer);output.innerHTML=`<h2>Receipt retained for café review</h2><p>${esc(saved.error||'Your payment evidence is retained privately.')}</p><p>Quote reference: <strong>${esc(quote.quote_id)}</strong>. No order was created. Contact the café; do not pay again.</p>`;
    quote=null;uploadedReceiptPath=null;return;
   }
   if(!placed.ok)throw Error(saved?.error||'Order placement failed.');
   if(!saved?.order)throw Error('The order service returned an incomplete response. Contact the café before retrying.');
   clearInterval(timer);quote=null;
   const order=saved.order,trackingUrl=new URL('track.html',location.href).href+'#token='+encodeURIComponent(order.tracking_token);
   output.innerHTML=`<h2>Order submitted for payment verification</h2><p>Reference: <strong>${esc(order.reference)}</strong></p><p>Your uploaded receipt is attached privately. The café will review payment before preparing your order.</p><p>Quoted total: <strong>${money(order.total)}</strong></p><a class="button secondary" data-track-order href="${esc(trackingUrl)}">Track order and payment</a><p class="checkout-note">Keep this private tracking link. It shows the café's latest status and your current downloadable receipt.</p>`;
   try{localStorage.removeItem('stacknsip-cart-v1');}catch{}
  }catch(error){feedback.textContent=error.message||'Could not submit this receipt. It remains private; retry or contact the café.';}
  finally{busy=false;if(quote&&submit){submit.disabled=!uploadedReceiptPath;receiptForm.elements.receipt.disabled=false;receiptForm.elements.payment_reference.disabled=false;}}
 }
 async function preparePaystack(){
  if(!quote||quote.payment_method!=='paystack'||paystackCheckout)return;
  if(paystackPreparePromise)return paystackPreparePromise;
  const feedback=output.querySelector('#paystack-checkout-status'),button=output.querySelector('[data-paystack-checkout]');
  button.disabled=true;feedback.textContent='Preparing secure Paystack checkout…';
  paystackPreparePromise=(async()=>{
   try{
    const [response]=await Promise.all([
     fetch('/.netlify/functions/initialize-paystack-payment',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({quote_id:quote.quote_id})}),
     loadPaystackInline()
    ]);
    const data=await responseData(response,'initialize-paystack-payment');if(!response.ok)throw Error(data?.error||'Could not prepare Paystack checkout.');
    if(!data)throw Error('The Paystack setup service returned an empty response. Check the Netlify function logs and retry.');
    if(!/^pk_(test|live)_/.test(data.public_key||'')||!/^SS-[A-Fa-f0-9-]{36}$/.test(data.reference||'')
       ||!Number.isSafeInteger(data.amount_kobo)||data.amount_kobo<=0||typeof data.email!=='string')throw Error('Paystack returned invalid checkout details.');
    if(!window.PaystackPop?.setup)throw Error('Paystack checkout could not be opened in this browser.');
    paystackCheckout=data;feedback.textContent='Secure checkout is ready. Click Continue to Paystack to open the payment window.';button.disabled=false;
   }catch(error){feedback.textContent=error.message||'Paystack checkout is unavailable. Retry or choose bank transfer.';button.disabled=false;}
   finally{paystackPreparePromise=null;}
  })();
  return paystackPreparePromise;
 }
 function startPaystack(){
  if(busy||!quote||quote.payment_method!=='paystack')return;
  const feedback=output.querySelector('#paystack-checkout-status'),button=output.querySelector('[data-paystack-checkout]');
  if(new Date(quote.expires_at).getTime()<=Date.now()){feedback.textContent='This quote expired. Start a new quote before paying.';return;}
  if(!paystackCheckout||!window.PaystackPop?.setup){preparePaystack();return;}
  busy=true;button.disabled=true;
  try{
   feedback.textContent='Opening secure Paystack checkout…';
   window.StackReceipt?.closeCheckout?.();
   const checkout=paystackCheckout;
   const handler=window.PaystackPop.setup({
    key:checkout.public_key,email:checkout.email,amount:checkout.amount_kobo,ref:checkout.reference,
    callback:result=>{
     const returnedReference=typeof result==='string'?result:result?.reference;
     if(returnedReference!==checkout.reference){feedback.textContent='The payment reference did not match. Do not pay again; contact Stack & Sip.';return;}
     verifyPaystack(checkout.reference,feedback);
    },
    onClose:()=>{window.StackReceipt?.openCheckout?.();if(quote&&feedback.isConnected){feedback.textContent='Paystack checkout was closed. No order was submitted; you can reopen payment with this quote.';button.disabled=false;}}
   });
   if(!handler||typeof handler.openIframe!=='function')throw Error('Paystack did not provide a checkout window. Check that the test/live API keys match in Netlify.');
   feedback.textContent='Choose your payment method in the secure Paystack window.';
   handler.openIframe();
   button.disabled=true;
  }catch(error){feedback.textContent=error.message||'Paystack checkout is unavailable. Retry or choose bank transfer.';button.disabled=false;}
  busy=false;
 }
 let paystackScriptPromise;
 function loadPaystackInline(){
  if(window.PaystackPop?.setup)return Promise.resolve();
  if(paystackScriptPromise)return paystackScriptPromise;
  paystackScriptPromise=new Promise((resolve,reject)=>{
   const script=document.createElement('script');script.src='https://js.paystack.co/v1/inline.js';
   script.onload=()=>window.PaystackPop?.setup?resolve():reject(Error('Paystack checkout could not be loaded.'));
   script.onerror=()=>reject(Error('Could not load Paystack. Check your connection or choose bank transfer.'));
   document.head.append(script);
  }).catch(error=>{paystackScriptPromise=null;throw error;});
  return paystackScriptPromise;
 }
 async function verifyPaystack(reference,feedback){
  feedback.textContent='Paystack received your response. Verifying payment securely…';
  try{
   const response=await fetch('/.netlify/functions/verify-paystack-payment',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({reference})});
   const data=await responseData(response,'verify-paystack-payment');if(!response.ok)throw Error(data?.error||'Could not verify the payment.');
   if(!data?.payment)throw Error('Payment verification returned an incomplete response. Do not pay again; retry verification or contact the café.');
   const payment=data.payment;
   if(payment.status==='paid'&&payment.tracking_token){
    clearInterval(timer);quote=null;
    if(checkoutTitle)checkoutTitle.textContent='Payment confirmed';
    const trackingUrl=new URL('track.html',location.href).href+'#token='+encodeURIComponent(payment.tracking_token);
    output.innerHTML=`<h2>Payment confirmed</h2><p>Order reference: <strong>${esc(payment.reference)}</strong></p><p>Paystack confirmed ${money(payment.total)}. Your order is now with the café.</p><a class="button secondary" data-track-order href="${esc(trackingUrl)}">Track order</a>`;
    try{localStorage.removeItem('stacknsip-cart-v1');}catch{}
    return;
   }
   if(payment.status==='paid_review'){
    clearInterval(timer);quote=null;
    if(checkoutTitle)checkoutTitle.textContent='Payment received — review needed';
    output.innerHTML=`<h2>Payment received — review needed</h2><p>${esc(payment.review_reason||'Paystack confirmed your payment, but the café needs to review it.')}</p><p>Paystack reference: <strong>${esc(reference)}</strong>. Contact Stack &amp; Sip and do not pay again.</p>`;
    return;
   }
   feedback.textContent='Paystack has not confirmed payment yet. Do not pay again; wait briefly and retry verification or contact Stack & Sip with reference '+reference+'.';
   const retry=output.querySelector('[data-paystack-checkout]');if(retry)retry.disabled=false;
  }catch(error){feedback.textContent=(error.message||'Payment verification is pending.')+' Do not pay again. Reference: '+reference+'.';const retry=output.querySelector('[data-paystack-checkout]');if(retry)retry.disabled=false;}
 }
 form.addEventListener('submit',createQuote);
 output.addEventListener('click',event=>{if(event.target.closest('[data-upload-receipt]'))uploadReceipt();});
 output.addEventListener('click',event=>{if(event.target.closest('[data-paystack-checkout]'))startPaystack();});
 output.addEventListener('change',event=>{if(event.target.matches('#quote-receipt-form [name="receipt"]')){uploadedReceiptPath=null;const place=output.querySelector('[data-place-order]');if(place)place.disabled=true;const upload=output.querySelector('[data-upload-receipt]');if(upload)upload.disabled=false;const feedback=output.querySelector('#quote-receipt-status');if(feedback)feedback.textContent='Upload this receipt to enable placing the order.';}});
 output.addEventListener('submit',event=>{if(event.target.id==='quote-receipt-form')placeOrder(event);});
 output.addEventListener('click',event=>{if(!event.target.closest('[data-reset-quote]'))return;clearInterval(timer);quote=null;paystackCheckout=null;paystackPreparePromise=null;output.replaceChildren();output.hidden=true;form.hidden=false;toggleForm(false);if(checkoutTitle)checkoutTitle.textContent='Customer details';if(checkoutDescription)checkoutDescription.hidden=false;status.textContent='Start a new quote. The current cart and customer details are still available.';window.StackReceipt?.openCheckout?.();});
 const emailInput=form.elements.email,emailLabel=emailInput.closest('label');
 const updatePaymentFields=()=>{const card=form.querySelector('[name="payment_method"]:checked')?.value==='paystack';emailInput.required=card;emailLabel.classList.toggle('paystack-email-required',card);const info=form.querySelector('[data-paystack-method-info]');if(info)info.hidden=!card;const button=form.querySelector('[data-checkout-submit]');if(button)button.textContent=card?'Make payment':'Generate order receipt & bank instructions';};
 form.addEventListener('change',event=>{if(event.target.matches('[name="payment_method"]'))updatePaymentFields();});
 updatePaymentFields();
 const returnState=new URLSearchParams(location.search).get('paystack');
 if(returnState){status.textContent=returnState==='review'?'Paystack confirmed payment, but your quote needs staff review. Contact Stack & Sip with reference '+(new URLSearchParams(location.search).get('reference')||'shown in your checkout').slice(0,100)+'. Do not pay again.':returnState==='pending'?'Paystack is still confirming this payment. Check your order tracking shortly or contact Stack & Sip with the payment reference.': 'Paystack payment was not confirmed. No order has been submitted; you may retry checkout.';}
 window.StackQuoteCheckout={};
})();
