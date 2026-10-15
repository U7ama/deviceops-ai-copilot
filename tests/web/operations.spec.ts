import { expect, test } from '@playwright/test';
import { approval, fixture, mockOperations, now } from './fixtures/operations';

// UI contract fixtures only: these tests do not claim backend, protocol, or Bedrock verification.
test.use({ launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {} });

test.describe('Operations UI with explicit API fixtures', () => {
  test('shows Gemini mode explicitly without claiming Bedrock inference', async ({ page }) => {
    const state = fixture();
    state.mode = 'gemini';
    await mockOperations(page, 'manager', state);
    await page.goto('/operations');
    await page.getByText('Investigation mode & usage budget', { exact: true }).click();
    await expect(page.getByText('Strands + Google Gemini', { exact: true })).toBeVisible();
    await expect(page.getByText('Strands + Amazon Bedrock', { exact: true })).toHaveCount(0);
  });

  test('requires a session before showing tenant data', async ({ page }) => {
    await page.route('**/api/v1/auth/me', (route) => route.fulfill({ status: 401, json: { detail: 'Session expired' } }));
    await page.goto('/operations');
    await expect(page.getByRole('heading', { name: 'Sign in to your workspace' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Go to sign in' })).toHaveAttribute('href', '/');
    await expect(page.getByRole('table')).toHaveCount(0);
  });

  test('preserves unknown health, authentication, source conflicts, and catalog status', async ({ page }) => {
    await mockOperations(page);
    await page.goto('/operations');
    await page.getByText('Investigation mode & usage budget', { exact: true }).click();
    await expect(page.getByText('Deterministic fixture', { exact: true })).toBeVisible();
    await page.getByRole('button',{name:'Rooms & Equipment',exact:true}).click();
    const switchRow = page.getByRole('row').filter({ hasText: 'Campus switch' });
    await expect(switchRow.getByText('unknown', { exact: true })).toHaveCount(2);
    await expect(switchRow.getByText('No observation')).toBeVisible();
    await expect(switchRow.getByText('online', { exact: true })).toHaveCount(0);
    const displayRow = page.getByRole('row').filter({ hasText: 'Room display' });
    await expect(displayRow.getByText('failed', { exact: true })).toBeVisible();
    await expect(displayRow.getByText('Source conflict')).toBeVisible();
    await page.getByRole('button', { name: 'Administration', exact: true }).click();
    await expect(page.getByText('57 catalog entries')).toBeVisible();
    await page.getByLabel('Find an integration').fill('Appspace');
    await expect(page.getByRole('heading', { name: 'Appspace' })).toBeVisible();
    await expect(page.getByRole('article').getByText('planned', { exact: true })).toBeVisible();
    await expect(page.getByText('Showing 1 of 57 entries')).toBeVisible();
  });

  test('submits the exact reviewed proposal, CSRF, note, and an idempotency key', async ({ page }) => {
    const actions = await mockOperations(page);
    await page.goto('/operations');
    await page.getByRole('button', { name: /Pending approvals/i }).click();
    await page.getByText(/Technical details: exact proposal & safety checks/i,{exact:true}).click();
    await expect(page.getByText(approval.hash)).toBeVisible();
    await expect(page.getByText(/Reachability: unreachable. Health: error/)).toBeVisible();
    await expect(page.getByText('test-policy-1')).toBeVisible();
    await page.getByLabel('Decision note').fill('Approved for the synthetic lab scenario.');
    await page.getByRole('button', { name: /^Approve Operation$/i, exact: true }).click();
    await expect(page.getByRole('status')).toContainText('Approval recorded');
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({ path: '/api/v2/approvals/approval-1/decision', body: { decision: 'approved', proposalHash: approval.hash, reason: 'Approved for the synthetic lab scenario.' }, csrf: 'test-csrf-token' });
    expect(actions[0]?.key).toMatch(/^[a-f0-9-]{36}$/);
    await expect(page.locator('.ops-status').filter({ hasText: /^awaiting approval$/i })).toHaveCount(2);
  });

  test('hides privileged controls from technicians', async ({ page }) => {
    await mockOperations(page, 'technician');
    await page.goto('/operations');
    await page.getByRole('button', { name: /Pending approvals/i }).click();
    await expect(page.getByText('A manager, admin, or owner must review this proposal.')).toBeVisible();
    await expect(page.getByRole('button', { name: /^Approve Operation$/i })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Operational Scenarios/i })).toHaveCount(0);
    await page.getByRole('button', { name: 'Administration', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Enroll candidate' })).toHaveCount(0);
  });

  test('makes expired approvals non-actionable', async ({ page }) => {
    const state = fixture();
    state.approvals[0]!.expiresAt = '2020-01-01T00:00:00.000Z';
    await mockOperations(page, 'manager', state);
    await page.goto('/operations');
    await page.getByRole('button', { name: /Open incidents/i }).click();
    await expect(page.getByText('expired', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Approve Operation$/i })).toHaveCount(0);
  });

  test('runs a scenario and enrolls only a selected candidate on a narrow screen', async ({ page }, testInfo) => {
    const actions = await mockOperations(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/operations');
    await page.getByRole('button', { name: /Operational Scenarios/i }).click();
    await page.getByRole('button', { name: /Telemetry service Investigate/ }).click();
    await expect(page.getByRole('status')).toContainText('drill initiated');
    expect(actions[0]?.body).toEqual({ scenario: 'service_hang' });
    await page.getByRole('button',{name:/Navigation ·/}).click();
    await page.getByRole('button', { name: 'Administration', exact: true }).click();
    await page.getByRole('button', { name: 'Enroll candidate' }).click();
    await expect(page.getByRole('status')).toContainText('enrollment accepted');
    expect(actions[1]?.path).toBe('/api/v2/discovery/candidate-1/enroll');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: testInfo.outputPath('operations-mobile.png'), fullPage: true });
  });


  test('requires deliberate review before publishing a reusable runbook', async ({ page }) => {
    const state = fixture();
    state.incidents[0]!.status = 'resolved';
    state.incidents[0]!.report = { title: 'Verified switch recovery', cause: 'Upstream switch outage', outcome: 'Three fresh healthy observations confirm recovery.', publication: 'draft' };
    state.approvals[0]!.status = 'executed';
    const actions = await mockOperations(page, 'manager', state);
    await page.goto('/operations');
    await page.getByRole('button', { name: /Open incidents/i }).click();
    await expect(page.getByRole('heading', { name: /Draft Incident Report/i })).toBeVisible();
    expect(actions).toHaveLength(0);
    await page.getByText(/Review & Publish Runbook/i, { exact: true }).click();
    await page.getByLabel(/Runbook Title/i).fill('Review upstream switch dependencies');
    await page.getByLabel(/Reviewed Runbook Content/i).fill('Check fresh switch reachability and configured downstream dependencies. Require manager approval for restart and confirm three fresh healthy samples afterward.');
    await page.getByRole('button', { name: /Publish Reviewed Runbook/i }).click();
    await expect(page.getByRole('status')).toContainText('Reviewed runbook published');
    expect(actions[0]).toMatchObject({ path: '/api/v2/incidents/incident-1/publish-runbook', body: { title: 'Review upstream switch dependencies' } });
  });

  test('keeps existing observations visibly stale when refresh fails', async ({ page }) => {
    await mockOperations(page);
    await page.goto('/operations');
    await page.getByRole('button',{name:'Rooms & Equipment',exact:true}).click();
    await expect(page.getByRole('table').getByText('Campus switch', { exact: true })).toBeVisible();
    await page.route('**/api/v2/state', (route) => route.fulfill({ status: 503, json: { detail: 'Collector temporarily unavailable' } }));
    await expect(page.getByRole('alert').filter({ hasText: 'Updates interrupted' })).toContainText('Displayed data may be stale', { timeout: 10_000 });
    await page.getByRole('button',{name:'Rooms & Equipment',exact:true}).click();
    await expect(page.getByRole('table').getByText('Campus switch', { exact: true })).toBeVisible();
  });
});


test('real authenticated operations screen reads backend state', async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  test.skip(!process.env.OPS_TEST_PASSWORD, 'Provide the disposable local seed password for this read-only live UI check.');
  await page.goto('/');
  await page.getByLabel('Email').fill('usamaaslam8726@gmail.com');
  await page.getByLabel('Password', { exact: true }).fill(process.env.OPS_TEST_PASSWORD!);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForURL('**/operations**', { timeout: 25_000 });
  await page.goto('/operations?view=fleet');
  await expect(page.getByRole('table')).toBeVisible({ timeout: 25_000 });
  await expect(page.getByRole('table').getByText('Core Distribution Switch', { exact: true })).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: testInfo.outputPath('operations-live-fleet.png'), fullPage: true });
  await page.getByRole('button', { name: /Open incidents/i }).click();
  await expect(page.getByRole('heading', { name: 'Incidents', level: 1, exact: true })).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: testInfo.outputPath('operations-live-incidents.png'), fullPage: true });
  await page.getByRole('button', { name: 'Administration', exact: true }).click();
  await expect(page.getByText('57 catalog entries')).toBeVisible();
});

test('theme preferences, history, missing incidents and mobile layout',async({page},testInfo)=>{
 await mockOperations(page);await page.goto('/operations?keep=yes');
 await expect(page.getByRole('heading',{name:'Overview',exact:true})).toBeVisible();
 await expect(page.locator('html')).toHaveAttribute('data-theme','light');
 await page.getByLabel('Color theme').selectOption('dark');await page.reload();
 await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
 await page.screenshot({path:testInfo.outputPath('overview-dark.png'),fullPage:true});
 await page.getByLabel('Color theme').selectOption('system');await page.emulateMedia({colorScheme:'light'});
 await expect(page.locator('html')).toHaveAttribute('data-theme','light');
 await page.getByRole('button',{name:'Rooms & Equipment',exact:true}).click();await expect(page).toHaveURL(/keep=yes/);
 await page.goBack();await expect(page.getByRole('heading',{name:'Overview',exact:true})).toBeVisible();
 await page.screenshot({path:testInfo.outputPath('overview-light.png'),fullPage:true});
 await page.goto('/operations?view=incidents&incident=missing');await expect(page.getByRole('heading',{name:'Incident unavailable'})).toBeVisible();
 await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test('theme works without storage and recovery errors remain explicit',async({page})=>{
 await page.addInitScript(()=>{Object.defineProperty(window,'localStorage',{get(){throw Error('blocked');}});});
 const state=fixture();state.incidents[0]!.status='escalated';state.approvals=[];
 state.events=[{id:'failure',incidentId:'incident-1',type:'verification.failed',createdAt:now,data:{evidenceIds:[]}}];
 await mockOperations(page,'manager',state);await page.goto('/operations?view=incidents&incident=incident-1');
 await expect(page.getByRole('heading',{name:'Incidents',level:1,exact:true})).toBeVisible();
 await page.getByLabel('Color theme').selectOption('dark');await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
 await expect(page.getByText('Recovery verification failed. Command acknowledgment did not establish recovery.')).toBeVisible();
 await expect(page.getByRole('button',{name:/^Approve Operation$/i,exact:true})).toHaveCount(0);
});

test('System tracks OS changes with blocked storage while explicit choices remain stable',async({page})=>{
 await page.addInitScript(()=>{Object.defineProperty(window,'localStorage',{get(){throw Error('blocked');}});});
 await mockOperations(page);await page.emulateMedia({colorScheme:'light'});await page.goto('/operations');
 await page.getByLabel('Color theme').selectOption('system');await page.emulateMedia({colorScheme:'dark'});
 await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
 await page.getByLabel('Color theme').selectOption('light');await page.emulateMedia({colorScheme:'light'});await page.emulateMedia({colorScheme:'dark'});
 await expect(page.locator('html')).toHaveAttribute('data-theme','light');
});
