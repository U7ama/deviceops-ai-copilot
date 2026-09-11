import {test,expect} from '@playwright/test';
test('acoustic preset and scanned mobile photo are visible',async({page},testInfo)=>{
 test.setTimeout(90000);test.skip(!process.env.OPS_TEST_PASSWORD,'Requires seeded local account');
 await page.goto('/');await page.getByLabel('Email').fill('manager@alpha.test');await page.getByLabel('Password',{exact:true}).fill(process.env.OPS_TEST_PASSWORD!);
 await page.getByRole('button',{name:'Sign in',exact:true}).click();await expect(page.getByRole('heading',{name:'Technician diagnosis workspace'})).toBeVisible();
 await page.getByRole('link',{name:'Operations',exact:true}).click();await page.getByRole('button',{name:'enterprise',exact:true}).click();
 await page.getByRole('button',{name:'Load acoustic spectrum analysis',exact:true}).click();
 await expect(page.getByRole('textbox',{name:'Python analysis',exact:true})).toHaveValue(/dominantObservedHz/);
 await expect(page.getByRole('button',{name:'Run isolated analysis',exact:true})).toBeDisabled();
 await expect(page.getByRole('img',{name:'Untrusted analysis chart acoustic-spectrum.png',exact:true}).first()).toBeVisible();
 const artifact=await page.evaluate(async()=>{const r=await fetch('/api/v2/enterprise');return (await r.json()).artifacts.find((a:any)=>a.name==='rack-photo.jpg'&&a.status==='ready'&&a.scan==='clean');});expect(artifact).toBeTruthy();
 await page.getByRole('combobox',{name:'Incident',exact:true}).selectOption(artifact.incidentId);
 await expect(page.getByRole('img',{name:'Evidence preview: rack-photo.jpg',exact:true}).first()).toBeVisible();
 await page.screenshot({path:testInfo.outputPath('acoustic-mobile-evidence.png'),fullPage:true});
});
