(() => {
 const config=window.STACK_CONFIG||{};
 const configured=!!(config.supabaseUrl&&config.supabasePublishableKey);
 let menuPromise;
 async function read(table){const response=await fetch(config.supabaseUrl.replace(/\/$/,'')+'/rest/v1/'+table,{headers:{apikey:config.supabasePublishableKey},cache:'no-store'});if(!response.ok)throw Error('The live menu is unavailable. Please retry.');return response.json();}
 async function loadMenu(){
  if(!configured){const r=await fetch('assets/menu.json');if(!r.ok)throw Error('Menu unavailable');return r.json();}
  const [categories,products,settings]=await Promise.all([read('categories?select=*&order=sort_order.asc'),read('products?select=*&order=sort_order.asc'),read('shop_settings?select=*')]);
  const shop=settings[0];if(!shop)throw Error('Shop settings unavailable');
  const result={categories:categories.map(c=>({id:c.id,title:c.title,subtitle:c.subtitle,note:c.note,photo:c.photo,photoAlt:c.photo_alt,photoGenerated:c.photo_generated,items:products.filter(p=>p.category_id===c.id).map(p=>[p.name,p.price,p.description,{id:p.id,available:p.available,photo:p.photo,photoAlt:p.photo_alt,photoGenerated:p.photo_generated}])})),settings:shop};
  window.StackBackend.settings=shop;document.querySelectorAll('[data-delivery-info]').forEach(e=>e.textContent='Delivery within '+shop.delivery_area+': ₦'+Number(shop.delivery_fee).toLocaleString('en-NG')+'. '+shop.delivery_note);window.dispatchEvent(new CustomEvent('stack-settings',{detail:shop}));return result;
 }
 window.StackBackend={configured,settings:{delivery_fee:6500,delivery_area:'Abuja Municipal',delivery_note:'Temporary estimate; final fee confirmed before acceptance.',accepting_orders:true},getMenu:()=>menuPromise||(menuPromise=loadMenu()),reloadMenu:()=>{menuPromise=null;return window.StackBackend.getMenu();}};
})();
