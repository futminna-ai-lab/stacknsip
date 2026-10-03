(() => {
  'use strict';
  const escape = x => String(x ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money = n => '₦' + Number(n).toLocaleString('en-NG');
  const key = 'stacknsip-cart-v1';
  const optionPricingKey = 'stacknsip-option-pricing-v2';
  let cart = {};
  try { const saved = JSON.parse(localStorage.getItem(key) || '{}'); if (saved && typeof saved === 'object' && !Array.isArray(saved)) for (const [id, qty] of Object.entries(saved)) if (Number.isInteger(qty) && qty > 0) cart[id] = Math.min(qty,99); } catch {}
  let catalog = new Map();
  let optionCatalog = [];
  function records(category) {
    const rows = category.items.filter(item=>!/^Extra(?:\s|:)/i.test(item[0])&&item[2]!=='Extra fillings').map(item => ({item,group:''}));
    for (const group of category.extras || []) for (const item of group.items) rows.push({item,group:group.title});
    if (category.icecream) rows.push({item:category.icecream,group:''});
    return rows.map(({item,group},i) => ({id:item[3]?.id||category.id+':'+i, name:item[0], price:item[1], description:[item[2],group].filter(Boolean).join(' · '), available:item[3]?.available!==false, photo:item[3]?.photo||category.photo, photoAlt:item[3]?.photoAlt||category.photoAlt, photoGenerated:item[3]?.photoGenerated??category.photoGenerated, category, options:category.id==='extras'?[]:(item[3]?.options||[])}));
  }
  function productId(lineId) { return lineId.split('~',1)[0]; }
  function lineOptions(lineId) { return lineId.includes('~') ? lineId.slice(lineId.indexOf('~')+1).split(',').filter(Boolean) : []; }
  function choiceGroup(row,id) { return row.options.find(group=>group.items.some(item=>item.id===id)); }
  function selectedOptions(row,ids) {
    const result=[];
    for(const group of row.options)for(const id of ids){const choice=group.items.find(item=>item.id===id);if(choice)result.push({...choice,available:choice.available&&group.available,group:group.name,included:false,price:choice.additional_price});}
    return result;
  }
  function unitPrice(row,ids=[]) { return row.price+selectedOptions(row,ids).reduce((sum,item)=>sum+(item.price||0),0); }
  function selectedFrom(container,row) {
    const ids=[];
    for(const group of row.options){const field=container.querySelector(`[data-option-group="${group.id}"]`);if(!field)continue;
      if(group.kind==='color'){const selected=field.querySelector('[data-offer-option]:checked');if(selected?.value)ids.push(selected.value);}
      else field.querySelectorAll('[data-offer-option]').forEach(select=>{if(select.value)ids.push(select.value);});
    }
    return ids;
  }
  function optionPayload(row,ids) {
    return row.options.filter(group=>group.available).map(group=>({
      group_id:group.id,
      choice_ids:ids.filter(id=>group.items.some(item=>item.id===id))
    }));
  }
  function migrateLegacyCart() {
    try { if(localStorage.getItem(optionPricingKey)==='done')return; } catch { return; }
    const migrated={};
    for(const [lineId,quantity] of Object.entries(cart)){
      const row=catalog.get(productId(lineId)),ids=lineOptions(lineId);
      if(!row||!ids.length){migrated[lineId]=(migrated[lineId]||0)+quantity;continue;}
      const counts=new Map(),remaining=ids.filter(id=>{const group=choiceGroup(row,id);if(!group)return true;const index=counts.get(group.id)||0;counts.set(group.id,index+1);return index>=group.included_selections;}),newId=row.id+(remaining.length?'~'+remaining.join(','):'');
      migrated[newId]=Math.min(99,(migrated[newId]||0)+quantity);
    }
    cart=migrated;
    try { localStorage.setItem(optionPricingKey,'done'); } catch {}
  }
  function minimumSelections(group) { return Math.max(group.minimum_selections,group.required?1:0); }
  function maxAdditionalSelections(group) { return Math.max(0,group.maximum_selections-group.included_selections); }
  function hasOptions(row) { return row.options.some(group=>group.available&&group.items.some(item=>item.available)); }
  function optionSelect(group,index) {
    const choices=group.items.filter(item=>item.available).map(item=>{
      const price=item.additional_price;
      const unavailablePrice=price===null;
      const priceLabel=price===null?' — price not set':' — extra +'+money(price);
      return `<option value="${escape(item.id)}"${unavailablePrice?' disabled':''}>${escape(item.name)}${priceLabel}</option>`;
    }).join('');
    return `<label>Optional ${escape(group.name.toLowerCase())} extra ${index+1}<select data-offer-option data-option-index="${index}"${index<minimumSelections(group)?' required':''}><option value="">No, thank you</option>${choices}</select></label>`;
  }
  function optionFields(row) {
    return row.options.filter(group=>group.available&&group.items.some(item=>item.available)).map(group=>{
      const choices=group.items.filter(item=>item.available);
      const minimum=minimumSelections(group),allowance=group.included_selections,maximum=maxAdditionalSelections(group),heading=`${escape(group.name)}${allowance?` · ${allowance} included in the offer price`:''}${maximum?` · optional extras are charged at the listed price`:''}${minimum?` · choose at least ${minimum} extra${minimum===1?'':'s'}`:''}`;
      if(group.kind==='color')return `<fieldset class="offer-options" data-option-group="${escape(group.id)}"><legend>${heading}</legend>${maximum?`<div class="option-color-grid">${minimum?'':`<label class="option-color"><input type="radio" name="color-${escape(group.id)}" data-offer-option value="" checked>No, thank you</label>`}${choices.map(item=>`<label class="option-color"><input type="radio" name="color-${escape(group.id)}" data-offer-option value="${escape(item.id)}"${minimum?' required':''}${item.additional_price===null?' disabled':''}><span aria-hidden="true" style="--option-color:${escape(item.color_value||'#ffffff')}"></span>${escape(item.name)}${item.additional_price===null?' — price not set':' — extra +'+money(item.additional_price)}</label>`).join('')}</div>`:'<p>No additional paid color choices are configured.</p>'}</fieldset>`;
      const initialCount=Math.min(maximum,Math.max(minimum,1)),initial=Array.from({length:initialCount},(_,i)=>optionSelect(group,i)).join('');
      return `<fieldset class="offer-options" data-option-group="${escape(group.id)}"><legend>${heading}</legend>${maximum?`<div data-option-slots>${initial}</div>${initialCount<maximum?`<button class="text-button" type="button" data-add-option-slot="${escape(group.id)}">Add another ${escape(group.name.toLowerCase())} extra</button>`:''}`:'<p>No additional paid choices are configured.</p>'}</fieldset>`;
    }).join('');
  }
  function persist() { try { localStorage.setItem(key,JSON.stringify(cart)); } catch {} refresh(); }
  async function reloadMenu() {
    const detail=document.querySelector('#product-detail .detail-copy');
    const oldProduct=currentProduct,oldSelections=oldProduct&&detail?selectedFrom(detail,oldProduct):[];
    const quantity=detail?.querySelector('.detail-purchase .quantity-control input')?.value;
    const data=await window.StackBackend.reloadMenu();
    catalog=new Map(data.categories.filter(category=>category.id!=='extras').flatMap(records).map(row=>[row.id,row]));
    for(const id of Object.keys(cart))if(!catalog.has(productId(id)))delete cart[id];
    persist();renderProduct();renderCart();
    const row=oldProduct&&catalog.get(oldProduct.id),newDetail=document.querySelector('#product-detail .detail-copy');
    if(row&&newDetail){
      const unavailable=[];
      for(const oldGroup of oldProduct.options){
        const group=row.options.find(option=>option.id===oldGroup.id),ids=oldSelections.filter(id=>oldGroup.items.some(item=>item.id===id));
        if(!ids.length)continue;
        if(!group?.available){unavailable.push(oldGroup.name);continue;}
        const field=newDetail.querySelector(`[data-option-group="${group.id}"]`);
        if(group.kind!=='color'&&!field?.querySelector('[data-option-slots]')){unavailable.push(oldGroup.name+': '+ids.map(id=>oldGroup.items.find(item=>item.id===id)?.name||'selected choice').join(', '));continue;}
        for(const id of ids){
          const choice=group.items.find(item=>item.id===id&&item.available);
          if(!choice){unavailable.push(oldGroup.name+': '+(oldGroup.items.find(item=>item.id===id)?.name||'selected choice'));continue;}
          if(group.kind==='color'){const radio=field?.querySelector(`[data-offer-option][value="${id}"]`);if(radio){radio.checked=true;radio.dispatchEvent(new Event('change',{bubbles:true}));}continue;}
          const slots=field?.querySelector('[data-option-slots]');
          if(!slots)continue;
          const controls=Array.from(slots.querySelectorAll('[data-offer-option]'));
          if(controls.length>=maxAdditionalSelections(group)&&controls.every(control=>control.value)){unavailable.push(oldGroup.name+': '+choice.name);continue;}
          if(controls.every(select=>select.value))field.querySelector('[data-add-option-slot]')?.click();
          const select=Array.from(slots.querySelectorAll('[data-offer-option]')).find(control=>!control.value);
          if(select){select.value=id;select.dispatchEvent(new Event('change',{bubbles:true}));}
        }
      }
      const input=newDetail.querySelector('.detail-purchase .quantity-control input');
      if(input&&quantity){input.value=quantity;input.dispatchEvent(new Event('input',{bubbles:true}));}
      if(unavailable.length)newDetail.querySelector('[data-option-status]').textContent=unavailable.join(', ')+' is no longer available. Choose a replacement or leave it at No, thank you.';
      else newDetail.querySelector('[data-option-status]').textContent='';
      if(input)updateProductTotal(input.closest('.quantity-control'),Math.max(1,Math.min(99,Math.floor(Number(quantity)||1))));
    }
    window.dispatchEvent(new CustomEvent('stack-menu-updated',{detail:data}));
    return data;
  }
  function refresh() {
    const total=Object.values(cart).reduce((a,b)=>a+b,0);
    document.querySelectorAll('[data-cart-count]').forEach(el=>el.textContent=total);
    document.querySelectorAll('[data-remove-status]').forEach(el=>el.hidden=!Object.keys(cart).some(id=>productId(id)===el.dataset.removeStatus));
    document.querySelectorAll('[data-cart-item]').forEach(el=>{const quantity=Object.keys(cart).filter(id=>productId(id)===el.dataset.cartItem).reduce((sum,id)=>sum+cart[id],0);el.textContent=quantity ? quantity+' in cart' : '';});
  }
  window.StackShop={records,refresh,hasOptions,reloadMenu};
  refresh();
  let currentProduct = null;
  function quantityControl(qty, id='') {
    return `<div class="quantity-control"${id ? ` data-cart-row="${escape(id)}"` : ''}><button type="button" data-quantity="-1" aria-label="Decrease quantity"${qty===1?' disabled':''}>−</button><input type="number" min="1" max="99" step="1" value="${qty}" aria-label="Quantity"><button type="button" data-quantity="1" aria-label="Increase quantity"${qty===99?' disabled':''}>+</button></div>`;
  }
  function updateProductTotal(control, qty) {
    const details=control.closest('.detail-copy'),purchase=control.closest('.detail-purchase'),id=purchase?.querySelector('[data-add]')?.dataset.add,row=catalog.get(id);
    if(!row)return;
    const unit=unitPrice(row,selectedFrom(details,row));
    const total=details?.querySelector('[data-product-total]'),label=details?.querySelector('[data-product-price-label]');
    if(total)total.textContent=money(unit*qty);
    if(label)label.textContent='total for '+qty+' '+(qty===1?'item':'items');
  }
  function renderProduct() {
    const target=document.getElementById('product-detail'); if(!target) return;
    const row=catalog.get(new URLSearchParams(location.search).get('item'));
    if(!row){ target.innerHTML='<h1>Offer not found</h1><a class="button" href="./#categories">Browse categories</a>';return; }
    currentProduct=row;const c={...row.category,photo:row.photo,photoAlt:row.photoAlt,photoGenerated:row.photoGenerated};document.title=row.name+' | Stack & Sip';
    target.innerHTML=`<nav class="breadcrumbs"><a href="./">Home</a><a href="category.html?category=${encodeURIComponent(c.id)}">${escape(c.title)}</a><span>${escape(row.name)}</span></nav><div class="product-detail-grid"><div class="detail-image">${c.photo ? `<button type="button" class="image-zoom" data-image-zoom aria-label="Enlarge product image"><img src="${escape(c.photo)}" alt="${escape(c.photoAlt)}"><span aria-hidden="true">⤢</span></button><button type="button" class="gallery-thumbnail" data-image-zoom aria-label="Enlarge product image"><img src="${escape(c.photo)}" alt=""></button><p class="photo-source">${c.photoGenerated ? 'Illustrative food image' : 'Photo from the ' + escape(c.title) + ' category'}</p>` : `<div class="detail-no-photo"><span>${escape(c.title)}</span></div>`}</div><div class="detail-copy"><h1>${escape(row.name)}</h1><div class="rating-summary"><span class="empty-stars" aria-label="No published rating">☆☆☆☆☆</span><a href="#customer-reviews">Reviews</a><button type="button" class="text-button" data-write-review>Write a review</button></div><div class="detail-price"><strong data-product-total aria-live="polite">${money(row.price)}</strong><span data-product-price-label>total for 1 item</span></div>${row.description ? `<p class="detail-description">${escape(row.description)}</p>` : ''}<p class="detail-category">Category: <a href="category.html?category=${encodeURIComponent(c.id)}">${escape(c.title)}</a></p>${c.note ? `<p class="detail-description">${escape(c.note)}</p>` : ''}${optionFields(row)}<p data-option-status role="status"></p><div class="detail-purchase">${quantityControl(1)}<button type="button" class="button secondary" data-add="${escape(row.id)}" data-use-quantity${row.available?'':' disabled'}>${row.available?'Add to cart':'Sold out'}</button></div><div class="in-cart-line"><span data-cart-item="${escape(row.id)}" aria-live="polite"></span><button type="button" class="text-button product-remove" data-remove="${escape(row.id)}" data-remove-status="${escape(row.id)}">Remove</button><a href="cart.html">View cart</a></div><p class="share-product">Share this product: <a href="https://wa.me/?text=${encodeURIComponent(row.name+' — '+money(row.price)+'\n'+new URL('product.html?item='+encodeURIComponent(row.id),location.href).href)}" target="_blank" rel="noopener noreferrer">WhatsApp</a></p></div></div>${reviewSection(row)}${relatedProducts(row)}`;refresh();
  }
  function reviewSection(row) {
    return `<section id="customer-reviews" class="customer-reviews"><div class="review-heading"><h2>Customer reviews</h2><button type="button" class="button secondary" data-write-review>Write a review</button></div><p>No published reviews yet. Share your experience with Stack & Sip.</p><p class="review-help">Reviews are sent to the café through WhatsApp. They are not published automatically.</p></section><dialog id="review-dialog" class="review-dialog"><form id="review-form"><div class="review-heading"><h2>Write a review</h2><button class="dialog-close" type="button" data-close-dialog aria-label="Close review form">×</button></div><p>${escape(row.name)}</p><label for="review-name">Your name</label><input id="review-name" name="name" autocomplete="name" required maxlength="80"><fieldset class="review-rating"><legend>Your rating</legend>${[1,2,3,4,5].map(n=>`<label><input type="radio" name="rating" value="${n}" required><span>${n} ★</span></label>`).join('')}</fieldset><label for="review-comment">Your review</label><textarea id="review-comment" name="comment" rows="5" required minlength="5" maxlength="1500" placeholder="Tell us about your experience"></textarea><p class="review-help">Your name, rating and review will open in WhatsApp. Review the message before sending it to Stack & Sip.</p><button class="button secondary" type="submit">Prepare review</button><div id="review-send" aria-live="polite"></div></form></dialog><dialog id="image-dialog" class="image-dialog"><button class="dialog-close" type="button" data-close-dialog aria-label="Close product image">×</button><img src="${escape(row.photo)}" alt="${escape(row.photoAlt)}"></dialog>`;
  }
  function relatedProducts(row) {
    const others=Array.from(catalog.values()).filter(r=>r.category.id===row.category.id && r.id!==row.id).slice(0,4);
    if(!others.length)return '';
    return `<section class="related-products"><h2>More from ${escape(row.category.title)}</h2><div class="related-grid">${others.map(r=>`<article><a href="product.html?item=${encodeURIComponent(r.id)}"><img src="${escape(r.photo)}" alt="${escape(r.photoAlt)}" loading="lazy"><h3>${escape(r.name)}</h3></a><p class="price">${money(r.price)}</p>${r.available&&hasOptions(r)?`<a class="text-button" href="product.html?item=${encodeURIComponent(r.id)}">Choose options</a>`:`<button type="button" class="text-button" data-add="${escape(r.id)}"${r.available?'':' disabled'}>${r.available?'Add To Cart':'Sold out'}</button>`}</article>`).join('')}</div></section>`;
  }
  function renderCart() {
    const target=document.getElementById('cart-content');if(!target)return;
    const rows=Object.keys(cart).filter(id=>catalog.has(productId(id)));
    if(window.StackReceipt) window.StackReceipt.setItems(rows.map(id=>{const r=catalog.get(productId(id)),ids=lineOptions(id),extras=selectedOptions(r,ids);return {id:r.id,name:r.name,category:r.category.title,base_price:r.price,option_total:unitPrice(r,ids)-r.price,price:unitPrice(r,ids),quantity:cart[id],available:r.available&&extras.every(extra=>extra.available),extras,options:optionPayload(r,ids)};}));
    if(!rows.length){target.innerHTML='<div class="cart-empty"><p>Your cart is empty.</p><a class="button secondary" href="./#categories">Browse the menu</a></div>';return;}
    const total=rows.reduce((sum,id)=>sum+unitPrice(catalog.get(productId(id)),lineOptions(id))*cart[id],0);
    const lines=rows.map(id=>{const r=catalog.get(productId(id)),ids=lineOptions(id),extras=selectedOptions(r,ids),extraTotal=extras.reduce((sum,item)=>sum+(item.price||0),0),unit=unitPrice(r,ids);return `${cart[id]} × ${r.name} (${r.category.title})${extras.length?' · Extras: '+extras.map(item=>item.name+' ('+money(item.price)+')').join(', '):''} — ${money(r.price)} base + ${money(extraTotal)} extras = ${money(unit)} each × ${cart[id]} = ${money(unit*cart[id])}`;});
    const message='Hello Stack & Sip, I would like to order:\n'+lines.join('\n')+'\nMenu subtotal: '+money(total)+'\nPlease confirm availability, pickup or delivery, delivery fee, and any sauce/topping choices.';
    target.innerHTML=`<div class="cart-layout"><div class="cart-items">${rows.map(id=>{const r=catalog.get(productId(id)),ids=lineOptions(id),extras=selectedOptions(r,ids),extraTotal=extras.reduce((sum,item)=>sum+(item.price||0),0),unit=unitPrice(r,ids),unavailableChoice=extras.find(item=>!item.available),availabilityMessage=!r.available?`${r.name} is sold out.`:unavailableChoice?`${unavailableChoice.group}: ${unavailableChoice.name} is unavailable.`:'',available=!availabilityMessage;return `<article class="cart-item"><div><a class="cart-item-name" href="product.html?item=${encodeURIComponent(r.id)}">${escape(r.name)}</a><p>${escape(r.category.title)}</p>${extras.length?`<p class="cart-item-extras">Extras: ${extras.map(item=>`${escape(item.group)}: ${escape(item.name)} (+${money(item.price)})`).join(', ')}</p>`:''}<span>${money(r.price)} base + ${money(extraTotal)} extras = ${money(unit)} each</span>${available?'':`<p class="sold-out-notice">${escape(availabilityMessage)} Remove or replace it before checkout.</p>`}</div><div>${quantityControl(cart[id],id)}<button class="remove-item" type="button" data-remove="${escape(id)}">Remove</button></div><div><small data-cart-line-formula>${cart[id]} × ${money(unit)} = </small><strong data-cart-line-total="${escape(id)}">${money(unit*cart[id])}</strong></div></article>`;}).join('')}</div><aside class="cart-summary"><h2>Order summary</h2><div class="cart-total"><span>Subtotal</span><strong data-cart-subtotal>${money(total)}</strong></div><p data-delivery-info>Delivery within Abuja Municipal: ₦6,500 temporary estimate. Exact fee and availability confirmed by Stack & Sip.</p><a class="button secondary" href="#order-checkout" data-open-order-form>Make order</a><p>Your choices and availability are checked again when we prepare the payment quote.</p><a class="details-link" href="https://stack-sip.orderwebsite.com/">Order through UpMenu</a><p class="checkout-note">UpMenu has a separate basket. Select your items there to use its checkout.</p></aside></div>`;
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
    const addSlot=event.target.closest('[data-add-option-slot]');
    if(addSlot){const row=currentProduct,group=row?.options.find(option=>option.id===addSlot.dataset.addOptionSlot),fieldset=addSlot.closest('[data-option-group]'),slots=fieldset?.querySelector('[data-option-slots]');if(!group||!slots||slots.querySelectorAll('[data-offer-option]').length>=maxAdditionalSelections(group))return;slots.insertAdjacentHTML('beforeend',optionSelect(group,slots.querySelectorAll('[data-offer-option]').length));if(!group.allow_repeats){const selected=Array.from(slots.querySelectorAll('[data-offer-option]'),select=>select.value).filter(Boolean),last=slots.lastElementChild?.querySelector('[data-offer-option]');if(last)Array.from(last.options).forEach(option=>{if(option.value&&selected.includes(option.value))option.disabled=true;});}if(slots.querySelectorAll('[data-offer-option]').length>=maxAdditionalSelections(group))addSlot.remove();return;}

    const add=event.target.closest('[data-add]');
    if(add && !add.disabled && catalog.has(add.dataset.add) && catalog.get(add.dataset.add).available){
      const input=add.hasAttribute('data-use-quantity')?add.closest('.detail-purchase').querySelector('input'):null;
      const qty=input?Math.max(1,Math.min(99,Math.floor(Number(input.value)||1))):1;
      const details=add.closest('.detail-copy'),row=catalog.get(add.dataset.add),extras=details?selectedFrom(details,row):[];
      const missing=row.options.find(group=>group.available&&extras.filter(id=>choiceGroup(row,id)?.id===group.id).length<minimumSelections(group));
      const optionStatus=details?.querySelector('[data-option-status]');
      if(missing){if(optionStatus)optionStatus.textContent='Choose at least '+minimumSelections(missing)+' '+missing.name.toLowerCase()+'.';return;}
      if(optionStatus)optionStatus.textContent='';
      const lineId=add.dataset.add+(extras.length?'~'+extras.join(','):'');
      cart[lineId]=Math.min(99,(cart[lineId]||0)+qty);persist();renderCart();return;
    }
    const remove=event.target.closest('[data-remove]');if(remove){const id=remove.dataset.remove;if(catalog.has(id)){for(const lineId of Object.keys(cart))if(productId(lineId)===id)delete cart[lineId];}else delete cart[id];persist();renderCart();return;}
    const button=event.target.closest('[data-quantity]');if(!button)return;
    const control=button.closest('.quantity-control'),input=control.querySelector('input');
    const qty=Math.max(1,Math.min(99,(Number(input.value)||1)+Number(button.dataset.quantity)));input.value=qty;
    if(control.dataset.cartRow){cart[control.dataset.cartRow]=qty;persist();renderCart();}else{control.querySelector('[data-quantity="-1"]').disabled=qty===1;control.querySelector('[data-quantity="1"]').disabled=qty===99;updateProductTotal(control,qty);}
  });
  document.addEventListener('change',event=>{
    if(!event.target.matches('[data-offer-option]'))return;
    const row=currentProduct,fieldset=event.target.closest('[data-option-group]'),group=row?.options.find(option=>option.id===fieldset?.dataset.optionGroup);
    if(group&&!group.allow_repeats&&group.kind!=='color'){
      const selected=Array.from(fieldset.querySelectorAll('[data-offer-option]'),select=>select.value).filter(Boolean);
      fieldset.querySelectorAll('[data-offer-option]').forEach(select=>Array.from(select.options).forEach(option=>{if(option.value)option.disabled=selected.includes(option.value)&&select.value!==option.value;}));
    }
    const control=document.querySelector('#product-detail .detail-purchase .quantity-control');
    if(control)updateProductTotal(control,Math.max(1,Math.min(99,Math.floor(Number(control.querySelector('input').value)||1))));
  });
  document.addEventListener('input',event=>{
    if(!event.target.matches('.quantity-control input'))return;
    const control=event.target.closest('.quantity-control'),id=control.dataset.cartRow;if(event.target.value==='')return;
    const qty=Math.max(1,Math.min(99,Math.floor(Number(event.target.value)||1)));
    if(!id){control.querySelector('[data-quantity="-1"]').disabled=qty===1;control.querySelector('[data-quantity="1"]').disabled=qty===99;updateProductTotal(control,qty);return;}
    const row=catalog.get(productId(id));cart[id]=qty;
    control.querySelector('[data-quantity="-1"]').disabled=qty===1;control.querySelector('[data-quantity="1"]').disabled=qty===99;
    const lineOptionsForRow=lineOptions(id),unit=row?unitPrice(row,lineOptionsForRow):0,line=control.closest('.cart-item')?.querySelector('[data-cart-line-total]'),formula=control.closest('.cart-item')?.querySelector('[data-cart-line-formula]');if(line&&row)line.textContent=money(unit*qty);if(formula&&row)formula.textContent=qty+' × '+money(unit)+' = ';
    const subtotal=document.querySelector('[data-cart-subtotal]');if(subtotal)subtotal.textContent=money(Object.keys(cart).reduce((sum,itemId)=>{const item=catalog.get(productId(itemId));return sum+(item?unitPrice(item,lineOptions(itemId))*cart[itemId]:0);},0));
    try{localStorage.setItem(key,JSON.stringify(cart));}catch{}
    const rows=Object.keys(cart).filter(itemId=>catalog.has(productId(itemId)));if(window.StackReceipt)window.StackReceipt.setItems(rows.map(itemId=>{const item=catalog.get(productId(itemId)),ids=lineOptions(itemId),extras=selectedOptions(item,ids);return {id:item.id,name:item.name,category:item.category.title,base_price:item.price,option_total:unitPrice(item,ids)-item.price,price:unitPrice(item,ids),quantity:cart[itemId],available:item.available&&extras.every(extra=>extra.available),extras,options:optionPayload(item,ids)};}));
    refresh();
  });
  document.addEventListener('change',event=>{
    if(!event.target.matches('.quantity-control input'))return;
    const qty=Math.max(1,Math.min(99,Math.floor(Number(event.target.value)||1))),control=event.target.closest('.quantity-control');event.target.value=qty;
    if(control.dataset.cartRow){cart[control.dataset.cartRow]=qty;persist();renderCart();}else{control.querySelector('[data-quantity="-1"]').disabled=qty===1;control.querySelector('[data-quantity="1"]').disabled=qty===99;updateProductTotal(control,qty);}
  });
  window.StackBackend.getMenu().then(data=>{
    catalog=new Map(data.categories.filter(category=>category.id!=='extras').flatMap(records).map(row=>[row.id,row]));
    for(const id of Object.keys(cart))if(!catalog.has(productId(id)))delete cart[id];migrateLegacyCart();persist();renderProduct();renderCart();
  }).catch(()=>{const target=document.getElementById('product-detail')||document.getElementById('cart-content');if(target)target.innerHTML='<p class="menu-error">The menu could not load. <a href="">Try again</a>.</p>';});
  let refreshingMenu=false;
  const refreshAvailability=()=>{if(refreshingMenu||document.hidden||!window.StackBackend.configured)return;refreshingMenu=true;reloadMenu().catch(error=>console.error('Customer menu availability refresh failed:',error)).finally(()=>{refreshingMenu=false;});};
  window.addEventListener('focus',refreshAvailability);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)refreshAvailability();});
})();
