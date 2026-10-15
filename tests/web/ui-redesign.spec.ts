import { expect, test, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { fixture, mockOperations } from './fixtures/operations';

// These browser tests assert UI behavior and unchanged API payloads using fixtures.
// Live device, worker, provider, and database verification is separate.
const views = [
  ['overview', 'Overview'], ['incidents', 'Incidents'], ['fleet', 'Rooms & Equipment'],
  ['approvals', 'Approvals'], ['knowledge', 'Knowledge'], ['admin', 'Administration']
] as const;
const palettes = ['vercel', 'claude', 'discord', 'supabase', 'mono', 'notebook', 'light-green', 'zen', 'astro-vista', 'whatsapp'];
test.use({ reducedMotion: 'reduce' });

async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

test('overview guides users to a proposal and keeps technical details expandable', async ({ page }) => {
  await mockOperations(page);
  await page.goto('/operations?keep=polish');
  await expect(page.getByRole('region', { name: 'Recommended next step' })).toContainText('A recovery proposal needs your review');
  await expect(page.getByText('Deterministic fixture', { exact: true })).not.toBeVisible();
  const mode = page.getByText('Investigation mode & usage budget', { exact: true });
  await mode.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByText('Deterministic fixture', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Review proposal', exact: true }).click();
  await expect(page).toHaveURL(/keep=polish.*view=incidents.*incident=incident-1/);
  await expect(page.getByLabel('Decision note')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Operations overview' })).toHaveCount(0);
  const exactProposal = page.getByText('Technical details: exact proposal & safety checks', { exact: true });
  await exactProposal.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByText('exact-server-proposal-hash', { exact: true })).toBeVisible();
});

test('equipment filters, accordions and card hover surfaces follow the selected palette', async ({ page }) => {
  await mockOperations(page);
  await page.goto('/operations?view=fleet');
  await page.getByLabel('Color theme').selectOption('light');
  const dropdown = page.getByLabel('Equipment filter');
  const before = await dropdown.evaluate(element => getComputedStyle(element).backgroundColor);
  await page.getByLabel('Dashboard palette').selectOption('claude');
  await expect.poll(() => dropdown.evaluate(element => getComputedStyle(element).backgroundColor)).not.toBe(before);
  await dropdown.selectOption('auth');
  await expect(page.getByRole('row').filter({ hasText: 'Room display' })).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: 'Campus switch' })).toHaveCount(0);
  const measurements = page.getByRole('row').filter({ hasText: 'Room display' }).getByText('Measurements', { exact: true });
  await measurements.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('row').filter({ hasText: 'Room display' }).locator('pre')).toContainText('temperatureC');
  await page.getByLabel('Color theme').selectOption('dark');
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe('dark');
  await page.goto('/operations');
  const card = page.getByRole('button', { name: 'Check equipment Find a room or device and inspect its latest observations.' });
  const normal = await card.evaluate(element => getComputedStyle(element).backgroundColor);
  await card.hover();
  await expect.poll(() => card.evaluate(element => getComputedStyle(element).backgroundColor)).not.toBe(normal);
  await card.click();
  await expect(page).toHaveURL(/view=fleet/);
});

for (const width of [1440, 900, 390]) {
  test(`all Operations views remain usable at ${width}px`, async ({ page }, testInfo) => {
    test.setTimeout(90_000);
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setViewportSize({ width, height: 960 });
    await mockOperations(page);
    for (const [view, label] of views) {
      await page.goto(`/operations?view=${view}&keep=preserved`);
      await expect(page.getByRole('heading', { name: label, level: 1, exact: true })).toBeVisible();
      await expect(page.getByLabel('Color theme')).toHaveCount(1);
      await expect(page.getByLabel('Dashboard palette')).toHaveCount(1);
      await expect(page.getByText(/Updates interrupted/)).toHaveCount(0);
      await noOverflow(page);
      for (const card of await page.locator('.metric-card').all()) {
        expect(await card.evaluate(element => [...element.querySelectorAll('[data-slot="card-header"], [data-slot="card-content"]')].every(child => child.scrollWidth <= child.clientWidth))).toBe(true);
      }
      for (const card of await page.locator('.overview-link').all()) {
        expect(await card.evaluate(element => element.scrollHeight <= element.clientHeight)).toBe(true);
      }
      await page.screenshot({ path: testInfo.outputPath(`${view}-${width}-light.png`) });
      await page.getByLabel('Color theme').selectOption('dark');
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
      await noOverflow(page);
      await page.screenshot({ path: testInfo.outputPath(`${view}-${width}-dark.png`) });
      await page.getByLabel('Color theme').selectOption('light');
    }
    expect(errors).toEqual([]);
  });
}

test('all palettes render real fleet statuses in both modes and persist separately', async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  await mockOperations(page);
  await page.goto('/operations?view=fleet');
  await expect(page.getByRole('table')).toBeVisible();
  for (const palette of palettes) {
    await page.getByLabel('Dashboard palette').selectOption(palette);
    for (const mode of ['light', 'dark']) {
      await page.getByLabel('Color theme').selectOption(mode);
      await expect(page.locator('html')).toHaveAttribute('data-palette', palette);
      await expect(page.locator('html')).toHaveAttribute('data-theme', mode);
      await expect(page.locator('html')).toHaveClass(mode === 'dark' ? /dark/ : /^(?!.*dark)/);
      await expect(page.getByRole('row').filter({ hasText: 'Room display' }).getByText('Source conflict')).toBeVisible();
      const background = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
      expect(background).not.toBe('rgba(0, 0, 0, 0)');
      await noOverflow(page);
      await page.screenshot({ path: testInfo.outputPath(`palette-${palette}-${mode}.png`) });
    }
  }
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-palette', 'whatsapp');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(await page.evaluate(() => ({ mode: localStorage.getItem('deviceops-theme'), palette: localStorage.getItem('deviceops-palette') }))).toEqual({ mode: 'dark', palette: 'whatsapp' });
});

test('sidebar collapse, keyboard drawer dismissal, focus return and navigation preserve history', async ({ page }, testInfo) => {
  await mockOperations(page);
  await page.goto('/operations?keep=yes');
  await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Toggle sidebar', exact: true }).click();
  await expect(page.locator('[data-slot="sidebar"][data-state]')).toHaveAttribute('data-state', 'collapsed');
  await page.getByRole('button', { name: 'Rooms & Equipment', exact: true }).click();
  await expect(page).toHaveURL(/keep=yes.*view=fleet/);
  await page.goBack();
  await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  const trigger = page.getByRole('button', { name: /Navigation · Overview/ });
  await trigger.click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect.poll(() => page.getByRole('dialog').evaluate(element => element.contains(document.activeElement))).toBe(true);
  for (let step = 0; step < 16; step++) {
    await page.keyboard.press('Tab');
    await expect.poll(() => page.getByRole('dialog').evaluate(element => element.contains(document.activeElement))).toBe(true);
  }
  await page.screenshot({ path: testInfo.outputPath('navigation-drawer-mobile.png') });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await trigger.click();
  await page.getByRole('button', { name: 'Knowledge', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Knowledge', level: 1 })).toBeVisible();
  await expect(page).toHaveURL(/keep=yes.*view=knowledge/);
  await noOverflow(page);
});

test('semantic incident status text remains readable in every palette', async ({ page }) => {
  const state = fixture();
  state.incidents.push({ ...state.incidents[0]!, id: 'resolved-incident', status: 'resolved' }, { ...state.incidents[0]!, id: 'escalated-incident', status: 'escalated' });
  await mockOperations(page, 'manager', state);
  await page.goto('/operations?view=incidents&incident=incident-1');
  await expect(page.getByRole('heading', { name: 'Incidents', level: 1, exact: true })).toBeVisible();
  await page.getByLabel('Incident filter').selectOption('all');
  for (const palette of palettes) {
    await page.getByLabel('Dashboard palette').selectOption(palette);
    for (const mode of ['light', 'dark']) {
      await page.getByLabel('Color theme').selectOption(mode);
      const contrasts = await page.locator('.ops-status').evaluateAll(elements => {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 1;
        const context = canvas.getContext('2d')!;
        const luminance = (color: string) => {
          context.clearRect(0, 0, 1, 1);
          context.fillStyle = color;
          context.fillRect(0, 0, 1, 1);
          const [r, g, b] = context.getImageData(0, 0, 1, 1).data;
          const channels = [r, g, b].map(value => {
            const v = value! / 255;
            return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
          });
          return channels[0]! * .2126 + channels[1]! * .7152 + channels[2]! * .0722;
        };
        return elements.map(element => {
          const style = getComputedStyle(element);
          const foreground = luminance(style.color), background = luminance(style.backgroundColor);
          return { text: element.textContent, ratio: (Math.max(foreground, background) + .05) / (Math.min(foreground, background) + .05) };
        });
      });
      for (const status of contrasts) expect(status.ratio, `${palette}/${mode}: ${status.text}`).toBeGreaterThanOrEqual(4.5);
    }
  }
});

test('invalid saved preferences fall back, and blocked storage still permits palette changes', async ({ page }) => {
  await page.addInitScript(() => { localStorage.setItem('deviceops-theme', 'invalid'); localStorage.setItem('deviceops-palette', 'invalid'); });
  await mockOperations(page);
  await page.goto('/operations');
  await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme-preference', 'system');
  await expect(page.locator('html')).toHaveAttribute('data-palette', 'vercel');
  await page.evaluate(() => { Object.defineProperty(window, 'localStorage', { get() { throw Error('blocked'); } }); });
  await page.getByLabel('Dashboard palette').selectOption('claude');
  await page.getByLabel('Color theme').selectOption('dark');
  await expect(page.locator('html')).toHaveAttribute('data-palette', 'claude');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

test('v2 rejection and failed-request retries retain exact hashes, notes and idempotency', async ({ page }) => {
  await mockOperations(page);
  let count = 0;
  const requests: { body: unknown; key?: string }[] = [];
  await page.route('**/api/v2/approvals/approval-1/decision', async route => {
    const request = route.request();
    requests.push({ body: request.postDataJSON(), key: request.headers()['idempotency-key'] });
    if (++count === 1) return route.abort('failed');
    return route.fulfill({ json: { accepted: true } });
  });
  await page.goto('/operations?view=incidents&incident=incident-1');
  await page.getByLabel('Decision note').fill('Evidence is insufficient.');
  await page.getByRole('button', { name: /^Reject Operation$/i }).click();
  await expect(page.getByRole('alert').filter({ hasText: /fetch|failed|network/i }).first()).toBeVisible();
  await page.getByRole('button', { name: /^Reject Operation$/i }).click();
  await expect(page.getByRole('status')).toContainText('Proposal rejected');
  expect(requests).toHaveLength(2);
  expect(requests[0]?.body).toEqual({ decision: 'rejected', proposalHash: 'exact-server-proposal-hash', reason: 'Evidence is insufficient.' });
  expect(requests[1]).toEqual(requests[0]);
});

async function legacyFixtures(page: Page, role = 'manager') {
  const actions: { path: string; body: unknown; csrf: string | undefined; key: string | undefined }[] = [];
  await page.route('**/api/**', async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() === 'POST') {
      actions.push({ path, body: request.postData() ? request.postDataJSON() : null, csrf: request.headers()['x-csrf-token'], key: request.headers()['idempotency-key'] });
      return route.fulfill({ json: { runId: 'run-1', incidentId: 'delivery-1', evalRunId: 'eval-1', accepted: true } });
    }
    if (path === '/api/v1/auth/me') return route.fulfill({ json: { user: { displayName: 'Test Manager', tenantName: 'UI Fixture Campus', role, demoMode: true } } });
    if (path === '/api/v1/auth/csrf') return route.fulfill({ json: { csrfToken: 'legacy-csrf' } });
    if (path === '/api/v1/devices') return route.fulfill({ json: { devices: [{ id: 'display-1', roomId: 'room-1', name: 'Room display', manufacturer: 'Sony', model: 'BRAVIA', room: { id: 'room-1', name: 'Room B', location: 'Campus' }, status: { online: false, powerState: 'off', input: null, observedAt: new Date().toISOString() } }] } });
    if (path === '/api/v1/approvals') return route.fulfill({ json: { approvals: [{ id: 'legacy-approval', runId: 'run-1', state: 'pending', proposalHash: 'legacy-exact-hash', expiresAt: new Date(Date.now() + 60_000).toISOString(), proposal: { summary: 'Reviewed display recovery', steps: [{ instruction: 'Inspect power first.' }] } }] } });
    if (path === '/api/v1/incidents') return route.fulfill({ json: { incidents: [{ id: 'delivery-1', runId: 'run-1', summary: 'Display notification', state: 'dead_lettered', assignedTeam: 'Operations', lastError: 'Delivery failed', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }] } });
    if (path === '/api/v1/eval-runs') return route.fulfill({ json: { evalRuns: [] } });
    if (path === '/api/v1/runs/run-1/events') return route.fulfill({ body: `data: ${JSON.stringify({ sequence: '1', type: 'approval.required', occurredAt: new Date().toISOString(), data: { approvalId: 'legacy-approval', proposalHash: 'legacy-exact-hash' } })}\n\n`, contentType: 'text/event-stream' });
    if (path === '/api/v1/runs/run-1') return route.fulfill({ json: { run: { id: 'run-1', state: 'awaiting_approval', question: 'Inspect display power', roomName: 'Room B', deviceName: 'Room display', diagnosis: { summary: 'Inspect the measured power state', uncertainty: 'Fixture only', citations: [{ id: 'citation-1', title: 'Display manual', page: 4, excerpt: 'Check the power connection.' }], serverDecision: { requiresApproval: true } } } } });
    return route.fulfill({ status: 404, json: { detail: 'Unexpected test request' } });
  });
  return actions;
}

test('specialist tools retain their v1 actions and run citations inside the shared shell', async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const actions = await legacyFixtures(page);
  await page.goto('/diagnosis');
  await expect(page.getByRole('heading', { name: /Technician Diagnosis Workspace/i })).toBeVisible();
  await page.getByLabel('Question or Observed Symptom').fill('Check the measured power state.');
  await page.getByRole('button', { name: 'Queue diagnosis', exact: true }).click();
  await expect(page.getByRole('link', { name: /Open run timeline/ })).toBeVisible();
  expect(actions[0]).toMatchObject({ path: '/api/v1/runs', body: { roomId: 'room-1', deviceId: 'display-1', question: 'Check the measured power state.', mediaIds: [] }, csrf: 'legacy-csrf' });
  expect(actions[0]?.key).toMatch(/^[a-f0-9-]{36}$/);
  await page.screenshot({ path: testInfo.outputPath('diagnosis-desktop.png') });
  await page.getByRole('link', { name: /Open run timeline/ }).click();
  await expect(page.getByText('Display manual')).toBeVisible();
  await expect(page.getByText('UI Fixture Campus', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Approve incident proposal', exact: true }).click();
  expect(actions[1]).toMatchObject({ path: '/api/v1/approvals/legacy-approval/decision', body: { decision: 'approved', proposalHash: 'legacy-exact-hash', reason: 'Approved via operator authorization workspace' }, csrf: 'legacy-csrf' });
  await page.screenshot({ path: testInfo.outputPath('run-desktop.png') });
  await page.goto('/approvals');
  await page.getByRole('button', { name: 'Approve Proposal', exact: true }).click();
  expect(actions[2]).toMatchObject({ path: '/api/v1/approvals/legacy-approval/decision', body: { decision: 'approved', proposalHash: 'legacy-exact-hash' }, csrf: 'legacy-csrf' });
  await page.screenshot({ path: testInfo.outputPath('legacy-approvals-desktop.png') });
  await page.goto('/incidents');
  await page.getByRole('button', { name: 'Retry Dispatch', exact: true }).click();
  expect(actions[3]).toMatchObject({ path: '/api/v1/incidents/delivery-1/retry', csrf: 'legacy-csrf' });
  await page.screenshot({ path: testInfo.outputPath('delivery-desktop.png') });
  await page.goto('/evaluations');
  await page.getByRole('button', { name: 'Queue Evaluation Run', exact: true }).click();
  expect(actions[4]).toMatchObject({ path: '/api/v1/eval-runs', body: { name: 'deviceops-eval-v1', version: '1.0.0', cases: [{ externalId: 'eval-case-001', category: 'answerable', input: { question: 'How do I check power for the Sony BRAVIA FW-85BZ40H?' }, expected: { shouldAbstain: false } }] }, csrf: 'legacy-csrf' });
  await page.screenshot({ path: testInfo.outputPath('evaluations-desktop.png') });
  for (const width of [1440, 900, 390]) {
    await page.setViewportSize({ width, height: 844 });
    for (const path of ['/diagnosis', '/runs/run-1', '/approvals', '/incidents', '/evaluations']) {
      await page.goto(path);
      await expect(page.locator('.dashboard-header')).toBeVisible();
      for (const mode of ['light', 'dark']) {
        await page.getByLabel('Color theme').selectOption(mode);
        await noOverflow(page);
        await page.screenshot({ path: testInfo.outputPath(`${path.replaceAll('/', '-')}-${width}-${mode}.png`) });
      }
    }
  }
});

test('evidence upload, analysis presets and operational controls retain reviewed payloads', async ({ page }, testInfo) => {
  const actions = await mockOperations(page);
  await page.route('**/api/v2/enterprise**', route => {
    if (route.request().method() !== 'GET' || new URL(route.request().url()).pathname !== '/api/v2/enterprise') return route.fallback();
    return route.fulfill({ json: {
    topology: [], impact: [], controls: { stopped: false, detectorMode: 'observe', replayVerified: true },
    anomalies: [], baselines: [], providers: { reasoning: 'fixture' }, analyses: [],
    artifacts: [{ id: 'waveform-1', incidentId: 'incident-1', name: 'waveform.csv', status: 'ready', scan: 'clean', pageCount: 0, hasPreview: false, confirmedDeviceId: null }],
    memory: { retrievalMode: 'lexical-only', results: [{ id: 'memory-1', title: 'Reviewed recovery procedure', text: 'Inspect fresh observations before recovery.', type: 'runbook', version: '1', reviewStatus: 'reviewed' }] }
    } });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/operations?view=incidents&incident=incident-1');
  const upload = page.getByRole('button', { name: 'Upload evidence files', exact: true });
  await upload.focus();
  const chooserPromise = page.waitForEvent('filechooser');
  await page.keyboard.press('Enter');
  const bytes = Buffer.from('time_seconds,baseline_amplitude,observed_amplitude\n0,1,2\n');
  await (await chooserPromise).setFiles({ name: 'telemetry.csv', mimeType: 'text/csv', buffer: bytes });
  await expect(page.getByRole('status')).toContainText('Evidence quarantined');
  expect(actions[0]).toMatchObject({ path: '/api/v2/artifacts', csrf: 'test-csrf-token', body: {
    incidentId: 'incident-1', name: 'telemetry.csv', contentType: 'text/csv', sha256: createHash('sha256').update(bytes).digest('hex'), data: bytes.toString('base64')
  } });
  await page.locator('.ops-toast').getByRole('button', { name: 'Dismiss notification', exact: true }).click();
  await expect(page.locator('.ops-toast')).toHaveCount(0);
  await page.getByRole('button', { name: 'Load Acoustic Spectrum Preset', exact: true }).click();
  await expect(page.getByLabel('Python analysis')).toHaveValue(/dominantObservedHz/);
  await page.locator('.ops-toast').getByRole('button', { name: 'Dismiss notification', exact: true }).click();
  const reviewedScript = await page.getByLabel('Python analysis').inputValue();
  await page.getByRole('button', { name: 'Run Isolated Analysis (1 file)', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Analysis queued');
  expect(actions[1]).toMatchObject({ path: '/api/v2/analyses', body: { incidentId: 'incident-1', artifactIds: ['waveform-1'], script: reviewedScript } });
  await page.locator('.ops-toast').getByRole('button', { name: 'Dismiss notification', exact: true }).click();
  await page.getByLabel('Associated equipment target:').selectOption('display-1');
  await expect(page.getByRole('status')).toContainText('Device association confirmed');
  expect(actions[2]).toMatchObject({ path: '/api/v2/artifacts/waveform-1/confirm', body: { deviceId: 'display-1' } });
  await noOverflow(page);
  await page.locator('.ops-toast').getByRole('button', { name: 'Dismiss notification', exact: true }).click();
  await expect(page.locator('.ops-toast')).toHaveCount(0);
  await upload.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('evidence-analysis-mobile.png') });
  await page.goto('/operations?view=admin');
  await page.getByRole('button', { name: 'Stop operations', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Operations control updated');
  expect(actions[3]).toMatchObject({ path: '/api/v2/enterprise/controls', body: { stopped: true } });
  await page.goto('/operations?view=knowledge');
  await page.getByLabel('Search Incident History & Reviewed Knowledge').fill('recovery');
  await expect(page.getByRole('heading', { name: 'Reviewed recovery procedure', exact: true })).toBeVisible();
  await noOverflow(page);
  expect(await page.locator('.ops-memory-grid').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.locator('.ops-memory-card').scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('knowledge-records-mobile.png') });
  for (const action of actions) {
    expect(action.csrf).toBe('test-csrf-token');
    expect(action.key).toMatch(/^[a-f0-9-]{36}$/);
  }
});

test('existing login and logout requests remain unchanged', async ({ page }, testInfo) => {
  let signedIn = false;
  const actions: { path: string; body: unknown; csrf: string | undefined }[] = [];
  const state = fixture();
  await page.route('**/api/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (request.method() === 'POST') {
      actions.push({ path, body: request.postData() ? request.postDataJSON() : null, csrf: request.headers()['x-csrf-token'] });
      signedIn = path === '/api/v1/auth/login';
      return route.fulfill({ json: { accepted: true } });
    }
    if (path === '/api/v1/auth/me') return route.fulfill(signedIn ? { json: { user: { displayName: 'Fixture Manager', tenantName: 'UI Fixture Campus', role: 'manager' } } } : { status: 401, json: { detail: 'Sign in required' } });
    if (path === '/api/v1/auth/csrf') return route.fulfill({ json: { csrfToken: 'login-csrf' } });
    if (path === '/api/v2/state') return route.fulfill({ json: state });
    if (path === '/api/v2/enterprise') return route.fulfill({ json: { topology: [], impact: [], controls: { stopped: false }, anomalies: [], baselines: [], artifacts: [], analyses: [], memory: { results: [] }, providers: {} } });
    return route.fulfill({ status: 404 });
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Sign in to DeviceOps' })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('sign-in-desktop.png') });
  await page.getByLabel('Email').fill('fixture@example.com');
  await page.getByLabel('Password', { exact: true }).fill('fixture-test-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/operations/);
  expect(actions[0]).toMatchObject({ path: '/api/v1/auth/login', body: { email: 'fixture@example.com', password: 'fixture-test-password', client: 'web' } });
  await page.context().addCookies([{ name: 'deviceops_csrf', value: 'logout-csrf', url: new URL(page.url()).origin }]);
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Sign in to DeviceOps' })).toBeVisible();
  expect(actions[1]).toMatchObject({ path: '/api/v1/auth/logout', csrf: 'logout-csrf' });
  await page.setViewportSize({ width: 390, height: 844 });
  await noOverflow(page);
  await page.screenshot({ path: testInfo.outputPath('sign-in-mobile.png') });
});
