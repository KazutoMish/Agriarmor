import { chromium } from './node_modules/playwright/index.mjs';
import assert from 'node:assert/strict';
const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
try {
const page=await browser.newPage({viewport:{width:390,height:844},reducedMotion:'reduce'});
await page.addInitScript(()=>localStorage.setItem('agriarmor-cart',JSON.stringify([{product_id:'00000000-0000-4000-8000-000000000001',quantity:2}])));
await page.route('https://*.supabase.co/**',route=>{
 const path=new URL(route.request().url()).pathname;
 const data=path.endsWith('/products')?[{id:'00000000-0000-4000-8000-000000000001',name:'RedRevive Con',description:'For home projects.',price:39,image_url:'/assets/redrevive-250.svg',category:'Home & DIY',stock:100,is_available:true,created_at:new Date().toISOString()}]:path.endsWith('/quote_order')?{subtotal:78,discount:0,delivery_fee:60,total:138}:[];
 return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
});
await page.goto('http://127.0.0.1:5173/checkout');
await page.getByRole('button',{name:'Place my order'}).waitFor();
await page.evaluate(()=>document.fonts.ready);
assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
await page.screenshot({path:'.tools/checkout-mobile.png',fullPage:true});
await page.setViewportSize({width:320,height:700});
assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
console.log('PASS fully rendered checkout at 390px and 320px has no horizontal overflow');
}finally{await browser.close();}
