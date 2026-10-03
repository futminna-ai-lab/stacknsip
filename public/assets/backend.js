(() => {
 const config=window.STACK_CONFIG||{};
 const configured=!!(config.supabaseUrl&&config.supabasePublishableKey);
 let menuPromise;
 async function read(table){const response=await fetch(config.supabaseUrl.replace(/\/$/,'')+'/rest/v1/'+table,{headers:{apikey:config.supabasePublishableKey},cache:'no-store'});if(!response.ok){let details={};try{details=await response.json();}catch{}const error=Error('The live menu is unavailable. Please retry.');error.status=response.status;error.code=details.code;error.table=table.split('?')[0];throw error;}return response.json();}
 async function loadMenu(){
  if(!configured){const r=await fetch('assets/menu.json');if(!r.ok)throw Error('Menu unavailable');return r.json();}
  const [categories,products,settings]=await Promise.all([read('categories?select=*&order=sort_order.asc'),read('products?select=*&order=sort_order.asc'),read('shop_settings?select=id,delivery_area,delivery_fee,delivery_note,accepting_orders')]);
  let groups=[],choices=[],optionsAvailable=true;
  try{[groups,choices]=await Promise.all([read('product_option_groups?select=*&order=sort_order.asc'),read('product_option_choices?select=*&order=sort_order.asc')]);}
  catch(error){if(error.code!=='PGRST205'||!['product_option_groups','product_option_choices'].includes(error.table))throw error;optionsAvailable=false;console.error('Database menu-option tables are missing. Apply migrations 006 and 007 before enabling online orders.',error.message);}
  const shop=settings[0];if(!shop)throw Error('Shop settings unavailable');
  const result={categories:categories.map(c=>({id:c.id,title:c.title,subtitle:c.subtitle,note:c.note,photo:c.photo,photoAlt:c.photo_alt,photoGenerated:c.photo_generated,items:products.filter(p=>p.category_id===c.id).map(p=>[p.name,p.price,p.description,{id:p.id,available:p.available,photo:p.photo,photoAlt:p.photo_alt,photoGenerated:p.photo_generated,options:groups.filter(g=>g.product_id===p.id).map(g=>({...g,items:choices.filter(choice=>choice.group_id===g.id).map(choice=>({...choice,available:choice.available&&(choice.source_product_id?products.find(source=>source.id===choice.source_product_id)?.available!==false:true)}))}))}])})),settings:shop,optionsAvailable};
  window.StackBackend.optionsAvailable=optionsAvailable;
  window.StackBackend.settings=shop;document.querySelectorAll('[data-delivery-info]').forEach(e=>e.textContent='Delivery within '+shop.delivery_area+': ₦'+Number(shop.delivery_fee).toLocaleString('en-NG')+'. '+shop.delivery_note);window.dispatchEvent(new CustomEvent('stack-settings',{detail:shop}));return result;
 }
 window.StackBackend={configured,optionsAvailable:null,settings:{delivery_fee:6500,delivery_area:'Abuja Municipal',delivery_note:'Temporary estimate; final fee confirmed before acceptance.',accepting_orders:true},getMenu:()=>menuPromise||(menuPromise=loadMenu()),reloadMenu:()=>{menuPromise=null;return window.StackBackend.getMenu();}};
})();
