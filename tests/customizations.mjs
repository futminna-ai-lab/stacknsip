import {JSDOM} from 'jsdom';
import fs from 'node:fs';
import assert from 'node:assert/strict';

const script=fs.readFileSync('public/assets/shop.js','utf8');
const tick=()=>new Promise(resolve=>setTimeout(resolve,20));
const categories=[
 {id:'bubble-drops',title:'Mini Bubble Drops',items:[['15pcs',8500,'2 syrups & 2 toppings.',{id:'bubble-drops:0',options:[
  {id:'syrups',name:'Syrups',available:true,required:false,minimum_selections:0,maximum_selections:4,included_selections:2,allow_repeats:false,kind:'choice',items:[
   {id:'syrup-a',name:'Chocolate',additional_price:800,available:true},{id:'syrup-b',name:'Pancake Syrup',additional_price:600,available:true},{id:'syrup-c',name:'Caramel',additional_price:300,available:true}
  ]},
  {id:'toppings',name:'Toppings',available:true,required:false,minimum_selections:0,maximum_selections:3,included_selections:2,allow_repeats:false,kind:'choice',items:[
   {id:'topping-a',name:'Rainbow Sprinkles',additional_price:800,available:true},{id:'topping-b',name:'Smarties',additional_price:600,available:true},{id:'topping-c',name:'Cashew',additional_price:800,available:true}
  ]}
 ]}]]},
 {id:'cup',title:'Cup',items:[['Cup',1000,'',{id:'cup:0',options:[{id:'colors',name:'Color',kind:'color',available:true,required:false,minimum_selections:0,maximum_selections:1,included_selections:0,items:[{id:'red',name:'Red',color_value:'#ff0000',additional_price:250,available:true}]}]}]]}
];
const getMenu=async()=>({categories});

let w=new JSDOM('<div id="product-detail"></div>',{url:'https://example.test/product.html?item=bubble-drops%3A0',runScripts:'outside-only'}).window;
w.StackBackend={getMenu,reloadMenu:getMenu};w.eval(script);await tick();
assert.equal(w.document.querySelectorAll('[data-offer-option]').length,2);
assert.match(w.document.querySelector('[data-option-group="syrups"]').textContent,/2 included in the offer price.*optional extras are charged/i);
assert.match(w.document.querySelector('[data-option-group="syrups"] [data-option-slots]').textContent,/No, thank you/);
assert.equal(w.document.querySelector('[data-product-total]').textContent,'₦8,500');
assert.equal(w.document.querySelector('[data-product-price-label]').textContent,'total for 1 item');
assert.doesNotMatch(w.document.querySelector('.detail-price').textContent,/Base price|Extras|Unit total/);
const selects=w.document.querySelectorAll('[data-offer-option]');
selects[0].value='syrup-c';selects[0].dispatchEvent(new w.Event('change',{bubbles:true}));
w.document.querySelector('[data-add-option-slot="syrups"]').click();
const secondSyrup=w.document.querySelector('[data-option-group="syrups"] [data-option-slots]').lastElementChild.querySelector('select');
assert.match(secondSyrup.parentElement.textContent,/Optional syrups extra 2/);
assert.match(Array.from(secondSyrup.options).find(option=>option.value==='syrup-a').textContent,/extra \+₦800/);
secondSyrup.value='syrup-a';secondSyrup.dispatchEvent(new w.Event('change',{bubbles:true}));
selects[1].value='topping-b';selects[1].dispatchEvent(new w.Event('change',{bubbles:true}));
assert.equal(w.document.querySelector('[data-product-total]').textContent,'₦10,200');
w.document.querySelector('.detail-purchase .quantity-control input').value='2';
w.document.querySelector('.detail-purchase .quantity-control input').dispatchEvent(new w.Event('input',{bubbles:true}));
assert.equal(w.document.querySelector('[data-product-total]').textContent,'₦20,400');
assert.equal(w.document.querySelector('[data-product-price-label]').textContent,'total for 2 items');
await w.StackShop.reloadMenu();
assert.equal(w.document.querySelector('.detail-purchase .quantity-control input').value,'2');
assert.deepEqual(Array.from(w.document.querySelectorAll('[data-offer-option]'),select=>select.value),['syrup-c','syrup-a','topping-b']);
assert.equal(w.document.querySelector('[data-product-total]').textContent,'₦20,400');
w.document.querySelector('[data-add="bubble-drops:0"]').click();
const cart=JSON.parse(w.localStorage.getItem('stacknsip-cart-v1'));
assert.equal(cart['bubble-drops:0~syrup-c,syrup-a,topping-b'],2);w.close();

w=new JSDOM('<div id="cart-content"></div>',{url:'https://example.test/cart.html',runScripts:'outside-only'}).window;
w.localStorage.setItem('stacknsip-cart-v1',JSON.stringify({'bubble-drops:0~syrup-a,syrup-b,syrup-c,topping-a,topping-b,topping-c':1}));
let receiptItems=[];w.StackReceipt={setItems:items=>{receiptItems=items;}};
w.StackBackend={getMenu};w.eval(script);await tick();
assert.match(w.document.querySelector('.cart-item-extras').textContent,/Caramel.*Cashew/);
assert.doesNotMatch(w.document.querySelector('.cart-item-extras').textContent,/included in offer price/i);
assert.equal(w.document.querySelector('[data-cart-line-total]').textContent,'₦9,600');
assert.equal(w.document.querySelector('[data-cart-subtotal]').textContent,'₦9,600');
assert.equal(receiptItems[0].extras.map(extra=>extra.name).join(', '),'Caramel, Cashew');
assert.equal(receiptItems[0].extras.filter(extra=>extra.included).length,0);
assert.equal(receiptItems[0].options[0].choice_ids.length,1);
const quantity=w.document.querySelector('.quantity-control input');quantity.value='2';
quantity.dispatchEvent(new w.Event('input',{bubbles:true}));
assert.equal(w.document.querySelector('[data-cart-subtotal]').textContent,'₦19,200');
assert.equal(receiptItems[0].price,9600);assert.equal(receiptItems[0].quantity,2);w.close();

const soldOutCategories=categories.map(category=>({...category,items:category.items.map(item=>[...item.slice(0,3),{...item[3],available:false}])}));
w=new JSDOM('<div id="cart-content"></div>',{url:'https://example.test/cart.html',runScripts:'outside-only'}).window;
w.localStorage.setItem('stacknsip-cart-v1',JSON.stringify({'bubble-drops:0~syrup-c':1}));
receiptItems=[];w.StackReceipt={setItems:items=>{receiptItems=items;}};
w.StackBackend={getMenu,reloadMenu:async()=>({categories:soldOutCategories})};w.eval(script);await tick();
await w.StackShop.reloadMenu();
assert.match(w.document.querySelector('.sold-out-notice').textContent,/15pcs is sold out.*Remove or replace it/i);
assert.equal(receiptItems[0].available,false);w.close();

 w=new JSDOM('<div id="product-detail"></div>',{url:'https://example.test/product.html?item=cup%3A0',runScripts:'outside-only'}).window;
 w.StackBackend={getMenu};w.eval(script);await tick();
 assert.equal(w.document.querySelector('[data-option-group="colors"] input[value=""]').checked,true);
 w.document.querySelector('[data-option-group="colors"] input[value="red"]').click();
 assert.equal(w.document.querySelector('[data-product-total]').textContent,'₦1,250');w.close();

console.log('PASS: included allowances need no selection; optional paid extras default to no thanks, and legacy included picks are not billed again.');
