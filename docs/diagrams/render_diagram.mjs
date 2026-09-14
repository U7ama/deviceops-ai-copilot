// Render the local architecture asset using existing Playwright dependencies.
import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const base = new URL('./', import.meta.url);
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1800, height: 1640 }, deviceScaleFactor: 2 });
  await page.setContent(`<style>html,body{margin:0;width:1800px;height:1640px}svg{display:block}@page{size:1800px 1640px;margin:0}</style>${await readFile(new URL('deviceops-architecture.svg', base), 'utf8')}`);
  await page.evaluate(() => document.fonts.ready);
  const overflow = await page.evaluate(() => [...document.querySelectorAll('svg text')].filter(t => {const b=t.getBBox();return b.x<0||b.y<0||b.x+b.width>1800||b.y+b.height>1640;}).map(t=>t.textContent));
  if (overflow.length) throw new Error(`Text outside diagram: ${overflow.join('; ')}`);
  await page.screenshot({path:fileURLToPath(new URL('deviceops-architecture.png',base))});
  await page.pdf({path:fileURLToPath(new URL('deviceops-architecture.pdf',base)),printBackground:true,preferCSSPageSize:true});
  console.log('PNG and PDF rendered; SVG text is within canvas bounds.');
} finally { await browser.close(); }
