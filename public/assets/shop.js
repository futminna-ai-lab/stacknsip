(() => {
  'use strict';
  const escape = x => String(x ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money = n => '₦' + Number(n).toLocaleString('en-NG');
  const key = 'stacknsip-cart-v1';
  let cart = {};
  try { const saved = JSON.parse(localStorage.getItem(key) || '{}'); if (saved && typeof saved === 'object' && !Array.isArray(saved)) for (const [id, qty] of Object.entries(saved)) if (Number.isInteger(qty) && qty > 0) cart[id] = Math.min(qty,99); } catch {}
  let catalog = new Map();
  function records(category) {
    const rows = category.items.map(item => ({item,group:''}));
    for (const group of category.extras || []) for (const item of group.items) rows.push({item,group:group.title});
    if (category.icecream) rows.push({item:category.icecream,group:''});
    return rows.map(({item,group},i) => ({id:item[3]?.id||category.id+':'+i, name:item[0], price:item[1], description:[item[2],group].filter(Boolean).join(' · '), available:item[3]?.available!==false, photo:item[3]?.photo||category.photo, photoAlt:item[3]?.photoAlt||category.photoAlt, photoGenerated:item[3]?.photoGenerated??category.photoGenerated, category}));
  }
  function persist() { try { localStorage.setItem(key,JSON.stringify(cart)); } catch {} refresh(); }
  function refresh() {
    const total=Object.values(cart).reduce((a,b)=>a+b,0);
    document.querySelectorAll('[data-cart-count]').forEach(el=>el.textContent=total);
    document.querySelectorAll('[data-remove-status]').forEach(el=>el.hidden=!cart[el.dataset.removeStatus]);
    document.querySelectorAll('[data-cart-item]').forEach(el=>el.textContent=cart[el.dataset.cartItem] ? cart[el.dataset.cartItem]+' in cart' : '');
  }
  window.StackShop={records,refresh};
  refresh();
  let currentProduct = null;
  function quantityControl(qty, id='') {
    return `<div class="quantity-control"${id ? ` data-cart-row="${escape(id)}"` : ''}><button type="button" data-quantity="-1" aria-label="Decrease quantity"${qty===1?' disabled':''}>−</button><input type="number" min="1" max="99" step="1" value="${qty}" aria-label="Quantity"><button type="button" data-quantity="1" aria-label="Increase quantity"${qty===99?' disabled':''}>+</button></div>`;
  }
  function renderProduct() {
    const target=document.getElementById('product-detail'); if(!target) return;
    const row=catalog.get(new URLSearchParams(location.search).get('item'));
    if(!row){ target.innerHTML='<h1>Offer not found</h1><a class="button" href="./#categories">Browse categories</a>';return; }
    currentProduct=row;const c={...row.category,photo:row.photo,photoAlt:row.photoAlt,photoGenerated:row.photoGenerated};document.title=row.name+' | Stack & Sip';
    target.innerHTML=`<nav class="breadcrumbs"><a href="./">Home</a><a href="category.html?category=${encodeURIComponent(c.id)}">${escape(c.title)}</a><span>${escape(row.name)}</span></nav><div class="product-detail-grid"><div class="detail-image">${c.photo ? `<button type="button" class="image-zoom" data-image-zoom aria-label="Enlarge product image"><img src="${escape(c.photo)}" alt="${escape(c.photoAlt)}"><span aria-hidden="true">⤢</span></button><button type="button" class="gallery-thumbnail" data-image-zoom aria-label="Enlarge product image"><img src="${escape(c.photo)}" alt=""></button><p class="photo-source">${c.photoGenerated ? 'Illustrative food image' : 'Photo from the ' + escape(c.title) + ' category'}</p>` : `<div class="detail-no-photo"><span>${escape(c.title)}</span></div>`}</div><div class="detail-copy"><h1>${escape(row.name)}</h1><div class="rating-summary"><span class="empty-stars" aria-label="No published rating">☆☆☆☆☆</span><a href="#customer-reviews">Reviews</a><button type="button" class="text-button" data-write-review>Write a review</button></div><p class="detail-price">${money(row.price)}</p>${row.description ? `<p class="detail-description">${escape(row.description)}</p>` : ''}<p class="detail-category">Category: <a href="category.html?category=${encodeURIComponent(c.id)}">${escape(c.title)}</a></p>${c.note ? `<p class="detail-description">${escape(c.note)}</p>` : ''}<div class="detail-purchase">${quantityControl(1)}<button type="button" class="button secondary" data-add="${escape(row.id)}" data-use-quantity${row.available?'':' disabled'}>${row.available?'Add to cart':'Sold out'}</button></div><div class="in-cart-line"><span data-cart-item="${escape(row.id)}" aria-live="polite"></span><button type="button" class="text-button product-remove" data-remove="${escape(row.id)}" data-remove-status="${escape(row.id)}">Remove</button><a href="cart.html">View cart</a></div><p class="share-product">Share this product: <a href="https://wa.me/?text=${encodeURIComponent(row.name+' — '+money(row.price)+'\n'+new URL('product.html?item='+encodeURIComponent(row.id),location.href).href)}" target="_blank" rel="noopener noreferrer">WhatsApp</a></p></div></div>${reviewSection(row)}${relatedProducts(row)}`;refresh();
  }
  function reviewSection(row) {
    return `<section id="customer-reviews" class="customer-reviews"><div class="review-heading"><h2>Customer reviews</h2><button type="button" class="button secondary" data-write-review>Write a review</button></div><p>No published reviews yet. Share your experience with Stack & Sip.</p><p class="review-help">Reviews are sent to the café through WhatsApp. They are not published automatically.</p></section><dialog id="review-dialog" class="review-dialog"><form id="review-form"><div class="review-heading"><h2>Write a review</h2><button class="dialog-close" type="button" data-close-dialog aria-label="Close review form">×</button></div><p>${escape(row.name)}</p><label for="review-name">Your name</label><input id="review-name" name="name" autocomplete="name" required maxlength="80"><fieldset class="review-rating"><legend>Your rating</legend>${[1,2,3,4,5].map(n=>`<label><input type="radio" name="rating" value="${n}" required><span>${n} ★</span></label>`).join('')}</fieldset><label for="review-comment">Your review</label><textarea id="review-comment" name="comment" rows="5" required minlength="5" maxlength="1500" placeholder="Tell us about your experience"></textarea><p class="review-help">Your name, rating and review will open in WhatsApp. Review the message before sending it to Stack & Sip.</p><button class="button secondary" type="submit">Prepare review</button><div id="review-send" aria-live="polite"></div></form></dialog><dialog id="image-dialog" class="image-dialog"><button class="dialog-close" type="button" data-close-dialog aria-label="Close product image">×</button><img src="${escape(row.photo)}" alt="${escape(row.photoAlt)}"></dialog>`;
  }
  function relatedProducts(row) {
    const others=Array.from(catalog.values()).filter(r=>r.category.id===row.category.id && r.id!==row.id).slice(0,4);
    if(!others.length)return '';
    return `<section class="related-products"><h2>More from ${escape(row.category.title)}</h2><div class="related-grid">${others.map(r=>`<article><a href="product.html?item=${encodeURIComponent(r.id)}"><img src="${escape(r.photo)}" alt="${escape(r.photoAlt)}" loading="lazy"><h3>${escape(r.name)}</h3></a><p class="price">${money(r.price)}</p><button type="button" class="text-button" data-add="${escape(r.id)}"${r.available?'':' disabled'}>${r.available?'Add To Cart':'Sold out'}</button></article>`).join('')}</div></section>`;
  }
  function renderCart() {
    const target=document.getElementById('cart-content');if(!target)return;
    const rows=Object.keys(cart).filter(id=>catalog.has(id));
    if(window.StackReceipt) window.StackReceipt.setItems(rows.map(id=>{const r=catalog.get(id);return {id:r.id,name:r.name,category:r.category.title,price:r.price,quantity:cart[id],available:r.available};}));
    if(!rows.length){target.innerHTML='<div class="cart-empty"><p>Your cart is empty.</p><a class="button secondary" href="./#categories">Browse the menu</a></div>';return;}
    const total=rows.reduce((sum,id)=>sum+catalog.get(id).price*cart[id],0);
    const lines=rows.map(id=>{const r=catalog.get(id);return `${cart[id]} × ${r.name} (${r.category.title}) — ${money(r.price*cart[id])}`;});
    const message='Hello Stack & Sip, I would like to order:\n'+lines.join('\n')+'\nMenu subtotal: '+money(total)+'\nPlease confirm availability, pickup or delivery, delivery fee, and any sauce/topping choices.';
    target.innerHTML=`<div class="cart-layout"><div class="cart-items">${rows.map(id=>{const r=catalog.get(id);return `<article class="cart-item"><div><a class="cart-item-name" href="product.html?item=${encodeURIComponent(id)}">${escape(r.name)}</a><p>${escape(r.category.title)}</p><span>${money(r.price)} each</span>${r.available?'':'<p class="sold-out-notice">Sold out — remove this item before ordering.</p>'}</div><div>${quantityControl(cart[id],id)}<button class="remove-item" type="button" data-remove="${escape(id)}">Remove</button></div><strong>${money(r.price*cart[id])}</strong></article>`;}).join('')}</div><aside class="cart-summary"><h2>Order summary</h2><div class="cart-total"><span>Subtotal</span><strong>${money(total)}</strong></div><p data-delivery-info>Delivery within Abuja Municipal: ₦6,500 temporary estimate. Exact fee and availability confirmed by Stack & Sip.</p><a class="button secondary" href="#order-checkout">Prepare WhatsApp order</a><p>Add your details below to generate your order message and PDF/image.</p><a class="details-link" href="https://stack-sip.orderwebsite.com/">Order through UpMenu</a><p class="checkout-note">UpMenu has a separate basket. Select your items there to use its checkout.</p></aside></div>`;
  }
  document.addEventListener('submit',event=>{
    if(event.target.id!=='review-form')return;
    event.preventDefault();
    const form=event.target;if(!form.reportValidity() || !currentProduct)return;
    const values=new FormData(form);
    const message='Review for '+currentProduct.name+' ('+currentProduct.category.title+')\nName: '+String(values.get('name')).trim()+'\nRating: '+values.get('rating')+'/5\n'+String(values.get('comment')).trim();
    document.getElementById('review-send').innerHTML=`<a class="button secondary" href="https://wa.me/2348161248972?text=${encodeURIComponent(message)}" target="_blank" rel="noopener noreferrer">Send review via WhatsApp</a>`;
  });
  document.addEventListener('click',event=>{
    const review=event.target.closest('[data-write-review]');if(review){document.getElementById('review-dialog').showModal();return;}
    const close=event.target.closest('[data-close-dialog]');if(close){close.closest('dialog').close();return;}
    const zoom=event.target.closest('[data-image-zoom]');if(zoom){document.getElementById('image-dialog').showModal();return;}

    const add=event.target.closest('[data-add]');
    if(add && !add.disabled && catalog.has(add.dataset.add) && catalog.get(add.dataset.add).available){
      const input=add.hasAttribute('data-use-quantity')?add.closest('.detail-purchase').querySelector('input'):null;
      const qty=input?Math.max(1,Math.min(99,Math.floor(Number(input.value)||1))):1;
      cart[add.dataset.add]=Math.min(99,(cart[add.dataset.add]||0)+qty);persist();return;
    }
    const remove=event.target.closest('[data-remove]');if(remove){delete cart[remove.dataset.remove];persist();renderCart();return;}
    const button=event.target.closest('[data-quantity]');if(!button)return;
    const control=button.closest('.quantity-control'),input=control.querySelector('input');
    const qty=Math.max(1,Math.min(99,(Number(input.value)||1)+Number(button.dataset.quantity)));input.value=qty;
    if(control.dataset.cartRow){cart[control.dataset.cartRow]=qty;persist();renderCart();}else{control.querySelector('[data-quantity="-1"]').disabled=qty===1;control.querySelector('[data-quantity="1"]').disabled=qty===99;}
  });
  document.addEventListener('change',event=>{
    if(!event.target.matches('.quantity-control input'))return;
    const qty=Math.max(1,Math.min(99,Math.floor(Number(event.target.value)||1))),control=event.target.closest('.quantity-control');event.target.value=qty;
    if(control.dataset.cartRow){cart[control.dataset.cartRow]=qty;persist();renderCart();}else{control.querySelector('[data-quantity="-1"]').disabled=qty===1;control.querySelector('[data-quantity="1"]').disabled=qty===99;}
  });
  window.StackBackend.getMenu().then(data=>{
    catalog=new Map(data.categories.flatMap(records).map(row=>[row.id,row]));
    for(const id of Object.keys(cart))if(!catalog.has(id))delete cart[id];persist();renderProduct();renderCart();
  }).catch(()=>{const target=document.getElementById('product-detail')||document.getElementById('cart-content');if(target)target.innerHTML='<p class="menu-error">The menu could not load. <a href="">Try again</a>.</p>';});
})();
