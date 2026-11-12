import { chromium } from './node_modules/playwright/index.mjs';
const browser = await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
try {
const page = await browser.newPage({viewport:{width:390,height:844},reducedMotion:'reduce'});
await page.goto('http://127.0.0.1:5173/',{waitUntil:'networkidle'});
await page.evaluate(()=>document.fonts.ready);
await page.screenshot({path:'.tools/mobile-top.png'});
await page.screenshot({path:'.tools/mobile-full.png',fullPage:true});
console.log(JSON.stringify(await page.evaluate(()=>({width:innerWidth,height:innerHeight,scroll:document.documentElement.scrollHeight,body:document.body.getBoundingClientRect().toJSON(),root:document.querySelector('#root').getBoundingClientRect().toJSON(),footer:document.querySelector('footer').getBoundingClientRect().toJSON(),overflow:[...document.querySelectorAll('body *')].filter(e=>e.getBoundingClientRect().bottom>document.querySelector('footer').getBoundingClientRect().bottom+100).map(e=>({tag:e.tagName,cls:e.className,b:e.getBoundingClientRect().toJSON()})).slice(0,12)}))));
await page.setViewportSize({width:1440,height:1000});
await page.screenshot({path:'.tools/desktop-top.png'});
await page.setViewportSize({width:1200,height:630});
await page.goto('http://127.0.0.1:5173/assets/og-card.html');
await page.evaluate(()=>Promise.all([...document.images].map(i=>i.decode())));
await page.screenshot({path:'public/assets/og-image.png'});
} finally {await browser.close();}
