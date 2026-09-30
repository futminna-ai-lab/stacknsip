(() => {
 'use strict';
 const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
 const money=value=>'₦'+Number(value||0).toLocaleString('en-NG');
 const date=value=>value?new Date(value).toLocaleString('en-NG',{timeZone:'Africa/Lagos',dateStyle:'medium',timeStyle:'short'}):'Not recorded';
 const paymentLabels={unpaid:'Unpaid',verification_pending:'Verification Pending',paid:'Paid',rejected:'Rejected',refunded:'Refunded'};
 const orderLabels={pending:'Pending',confirmed:'Confirmed',preparing:'Preparing',ready:'Ready',completed:'Completed',cancelled:'Cancelled'};
 function render(order){
  const total=order.total??(Number(order.subtotal||0)+Number(order.delivery_fee||0));
  return `<article class="system-order-receipt"><header><strong>STACK &amp; SIP</strong><span>Green Gardens, Wuse Zone 1, Abuja</span><span>0816 124 8972</span><h1>ORDER RECEIPT</h1></header><dl class="receipt-meta"><div><dt>Order Number</dt><dd>${escape(order.reference)}</dd></div><div><dt>Order Date</dt><dd>${escape(date(order.created_at))}</dd></div><div><dt>Customer</dt><dd>${escape(order.name)}</dd></div><div><dt>Phone</dt><dd>${escape(order.phone)}</dd></div><div><dt>Fulfillment</dt><dd>${escape(order.fulfillment)}</dd></div>${order.fulfillment==='Delivery'&&order.address?`<div><dt>Delivery Address</dt><dd>${escape(order.address)}</dd></div>`:''}</dl><h2>Items</h2><table><thead><tr><th>Item</th><th>Qty</th><th>Unit</th><th>Subtotal</th></tr></thead><tbody>${(order.items||[]).map(item=>`<tr><td>${escape(item.name)}</td><td>${Number(item.quantity)}</td><td>${money(item.price)}</td><td>${money(Number(item.price)*Number(item.quantity))}</td></tr>`).join('')}</tbody></table><dl class="receipt-totals"><div><dt>Subtotal</dt><dd>${money(order.subtotal)}</dd></div><div><dt>Delivery Fee</dt><dd>${money(order.delivery_fee)}</dd></div><div class="receipt-total"><dt>Total</dt><dd>${money(total)}</dd></div></dl><section><h2>Payment</h2><p>Method: ${escape(order.payment_method==='bank_transfer'?'Bank Transfer':order.payment_method||'Not recorded')}</p><p>Status: ${escape(paymentLabels[order.payment_status]||'Unknown')}</p>${order.payment_reference?`<p>Reference: ${escape(order.payment_reference)}</p>`:''}${order.payment_verified_at?`<p>Verified: ${escape(date(order.payment_verified_at))}</p>`:''}</section><section><h2>Order</h2><p>Status: ${escape(orderLabels[order.status]||order.status||'Unknown')}</p></section><footer><button type="button" data-print-order-receipt>Print Receipt</button></footer></article>`;
 }
 document.addEventListener('click',event=>{if(event.target.closest('[data-print-order-receipt]'))window.print();});
 window.StackOrderReceipt={render};
})();
