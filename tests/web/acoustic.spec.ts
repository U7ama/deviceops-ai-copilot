import {test,expect} from '@playwright/test';
test('acoustic preset and scanned mobile photo are visible',async({page},testInfo)=>{
 test.setTimeout(90000);test.skip(!process.env.OPS_TEST_PASSWORD,'Requires seeded local account');
 await page.goto('/');await page.getByLabel('Email').fill('usamaaslam8726@gmail.com');await page.getByLabel('Password',{exact:true}).fill(process.env.OPS_TEST_PASSWORD!);
 await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.waitForURL('**/operations**',{ timeout: 25000 });
 await page.getByRole('link',{name:/Operations/}).click();
 const artifact=await page.evaluate(async()=>{const r=await fetch('/api/v2/enterprise');return (await r.json()).artifacts.find((a:any)=>a.name==='rack-photo.jpg'&&a.status==='ready'&&a.scan==='clean');});expect(artifact).toBeTruthy();
 await page.goto(`/operations?view=incidents&incident=${artifact.incidentId}`);
 await page.getByRole('button',{name:'Load acoustic spectrum analysis',exact:true}).click();
 await expect(page.getByRole('textbox',{name:'Python analysis',exact:true})).toHaveValue(/dominantObservedHz/);
 await expect(page.getByRole('button',{name:'Run isolated analysis',exact:true})).toBeDisabled();
 await expect(page.getByRole('img',{name:'Untrusted analysis chart acoustic-spectrum.png',exact:true}).first()).toBeVisible();
 await expect(page.getByRole('img',{name:'Evidence preview: rack-photo.jpg',exact:true}).first()).toBeVisible();
 await page.evaluate(() => window.scrollTo(0, 0));
 await page.waitForTimeout(300);
 await page.screenshot({path:testInfo.outputPath('acoustic-mobile-evidence.png'),fullPage:true});
});
