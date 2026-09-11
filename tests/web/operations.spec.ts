import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

// UI contract fixtures only: these tests do not claim backend, protocol, or Bedrock verification.
const now = new Date().toISOString();
const approval = { id: 'approval-1', incidentId: 'incident-1', name: 'restart_switch', targetDeviceId: 'switch-1', risk: 'approval_required', status: 'pending', hash: 'exact-server-proposal-hash', expiresAt: new Date(Date.now() + 1_800_000).toISOString(), evidenceIds: ['observation-1'], preconditions: { generation: 1, sourceMode: 'simulated', kind: 'switch' }, policyVersion: 'test-policy-1' };
function fixture() {
  return {
    devices: [
      { id: 'switch-1', name: 'Campus switch', room: 'Network closet', kind: 'switch', health: 'unknown', reachability: 'unknown', auth: 'unknown', observedAt: null, sourceMode: 'simulated', conflict: false, metrics: {} },
      { id: 'display-1', name: 'Room display', room: 'Room B', kind: 'display', health: 'warning', reachability: 'reachable', auth: 'failed', observedAt: now, sourceMode: 'simulated', conflict: true, metrics: { temperatureC: 38 } }
    ],
    incidents: [{ id: 'incident-1', summary: 'Upstream switch is unreachable', cause: 'Likely upstream outage', status: 'awaiting_approval', severity: 'high', deviceIds: ['switch-1', 'display-1'], createdAt: now, updatedAt: now, diagnosis: { summary: 'An upstream outage is likely.', cause: 'Switch and dependents are unreachable.', evidenceIds: ['observation-1'], alternatives: ['Power loss'], uncertainty: 'Synthetic test fixture.', provider: 'fixture' }, report: null as Record<string, unknown> | null, evidence: [{ id: 'observation-1', kind: 'observation', deviceId: 'switch-1', source: 'simulator.local', observedAt: now, reachability: 'unreachable', health: 'error', auth: 'ok', metrics: { portsUp: 0 } }] }],
    approvals: [{ ...approval }],
    events: [{ id: 'event-1', incidentId: 'incident-1', type: 'diagnosis.validated', createdAt: now, data: { evidenceIds: ['observation-1'] } }],
    connectors: [{ id: 'ping', name: 'Ping', category: 'lan', status: 'simulator-tested' }, { id: 'appspace', name: 'Appspace', category: 'cloud', status: 'planned' }, ...Array.from({ length: 55 }, (_, index) => ({ id: `test-${index}`, name: `Catalog fixture ${index + 1}`, category: 'test-fixture', status: 'planned' }))],
    discovery: [{ id: 'candidate-1', name: 'Candidate projector', address: 'simulator://projector', status: 'candidate' }],
    mode: 'fixture', budget: { spentUsd: 0, limitUsd: 6, reservedUsd: 0 }
  };
}

test.use({ launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {} });

async function mockOperations(page: Page, role = 'manager', state = fixture()) {
  const actions: { path: string; body: Record<string, unknown>; csrf: string | undefined; key: string | undefined }[] = [];
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === '/api/v1/auth/me') return route.fulfill({ json: { user: { displayName: 'Test Manager', tenantName: 'Synthetic UI Test', role } } });
    if (path === '/api/v1/auth/csrf') return route.fulfill({ json: { csrfToken: 'test-csrf-token' } });
    if (path === '/api/v2/state') return route.fulfill({ json: state });
    if (request.method() === 'POST') {
      actions.push({ path, body: request.postDataJSON() as Record<string, unknown>, csrf: request.headers()['x-csrf-token'], key: request.headers()['idempotency-key'] });
      return route.fulfill({ json: { accepted: true } });
    }
    return route.fulfill({ status: 404, json: { detail: 'Unexpected test request' } });
  });
  return actions;
}

test.describe('Operations UI with explicit API fixtures', () => {
  test('shows Gemini mode explicitly without claiming Bedrock inference', async ({ page }) => {
    const state = fixture();
    state.mode = 'gemini';
    await mockOperations(page, 'manager', state);
    await page.goto('/operations');
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
    await expect(page.getByText('Deterministic fixture', { exact: true })).toBeVisible();
    const switchRow = page.getByRole('row').filter({ hasText: 'Campus switch' });
    await expect(switchRow.getByText('unknown', { exact: true })).toHaveCount(3);
    await expect(switchRow.getByText('No observation')).toBeVisible();
    await expect(switchRow.getByText('online', { exact: true })).toHaveCount(0);
    const displayRow = page.getByRole('row').filter({ hasText: 'Room display' });
    await expect(displayRow.getByText('failed', { exact: true })).toBeVisible();
    await expect(displayRow.getByText('Source conflict')).toBeVisible();
    await page.getByRole('button', { name: 'integrations', exact: true }).click();
    await expect(page.getByText('57 catalog entries')).toBeVisible();
    await page.getByLabel('Find an integration').fill('Appspace');
    await expect(page.getByRole('heading', { name: 'Appspace' })).toBeVisible();
    await expect(page.getByRole('article').getByText('planned', { exact: true })).toBeVisible();
    await expect(page.getByText('Showing 1 of 57 entries')).toBeVisible();
  });

  test('submits the exact reviewed proposal, CSRF, note, and an idempotency key', async ({ page }) => {
    const actions = await mockOperations(page);
    await page.goto('/operations');
    await page.getByRole('button', { name: /Awaiting review/ }).click();
    await expect(page.getByText(approval.hash)).toBeVisible();
    await page.getByText('Inspect 1 stored evidence records').click();
    await expect(page.getByText(/Reachability: unreachable. Health: error/)).toBeVisible();
    await page.getByText('Preconditions and exact arguments').click();
    await expect(page.getByText('test-policy-1')).toBeVisible();
    await page.getByLabel('Decision note').fill('Approved for the synthetic lab scenario.');
    await page.getByRole('button', { name: 'Approve operation', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('Approval recorded');
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({ path: '/api/v2/approvals/approval-1/decision', body: { decision: 'approved', proposalHash: approval.hash, reason: 'Approved for the synthetic lab scenario.' }, csrf: 'test-csrf-token' });
    expect(actions[0]?.key).toMatch(/^[a-f0-9-]{36}$/);
    await expect(page.getByText('awaiting approval', { exact: true })).toHaveCount(2);
  });

  test('hides privileged controls from technicians', async ({ page }) => {
    await mockOperations(page, 'technician');
    await page.goto('/operations');
    await page.getByRole('button', { name: /Awaiting review/ }).click();
    await expect(page.getByText('A manager, admin, or owner must review this proposal.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Approve operation' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Demo scenarios/ })).toHaveCount(0);
    await page.getByRole('button', { name: 'discovery', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Enroll candidate' })).toHaveCount(0);
  });

  test('makes expired approvals non-actionable', async ({ page }) => {
    const state = fixture();
    state.approvals[0]!.expiresAt = '2020-01-01T00:00:00.000Z';
    await mockOperations(page, 'manager', state);
    await page.goto('/operations');
    await page.getByRole('button', { name: /Open incidents/ }).click();
    await expect(page.getByText('expired', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Approve operation' })).toHaveCount(0);
  });

  test('runs a scenario and enrolls only a selected candidate on a narrow screen', async ({ page }, testInfo) => {
    const actions = await mockOperations(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/operations');
    await page.getByRole('button', { name: /Demo scenarios/ }).click();
    await page.getByRole('button', { name: /Telemetry service Investigate/ }).click();
    await expect(page.getByRole('status')).toContainText('fault injected');
    expect(actions[0]?.body).toEqual({ scenario: 'service_hang' });
    await page.getByRole('button', { name: 'discovery', exact: true }).click();
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
    await page.getByRole('button', { name: /Open incidents/ }).click();
    await expect(page.getByRole('heading', { name: 'Draft incident report' })).toBeVisible();
    expect(actions).toHaveLength(0);
    await page.getByText('Review and publish a runbook', { exact: true }).click();
    await page.getByLabel('Runbook title').fill('Review upstream switch dependencies');
    await page.getByLabel('Reviewed runbook content').fill('Check fresh switch reachability and configured downstream dependencies. Require manager approval for restart and confirm three fresh healthy samples afterward.');
    await page.getByRole('button', { name: 'Publish reviewed runbook' }).click();
    await expect(page.getByRole('status')).toContainText('Reviewed runbook published');
    expect(actions[0]).toMatchObject({ path: '/api/v2/incidents/incident-1/publish-runbook', body: { title: 'Review upstream switch dependencies' } });
  });

  test('keeps existing observations visibly stale when refresh fails', async ({ page }) => {
    await mockOperations(page);
    await page.goto('/operations');
    await expect(page.getByText('Campus switch', { exact: true })).toBeVisible();
    await page.route('**/api/v2/state', (route) => route.fulfill({ status: 503, json: { detail: 'Collector temporarily unavailable' } }));
    await expect(page.getByRole('alert').filter({ hasText: 'Updates interrupted' })).toContainText('Displayed data may be stale', { timeout: 10_000 });
    await expect(page.getByText('Campus switch', { exact: true })).toBeVisible();
  });
});


test('real authenticated operations screen reads backend state', async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  test.skip(!process.env.OPS_TEST_PASSWORD, 'Provide the disposable local seed password for this read-only live UI check.');
  await page.goto('/');
  await page.getByLabel('Email').fill('manager@alpha.test');
  await page.getByLabel('Password', { exact: true }).fill(process.env.OPS_TEST_PASSWORD!);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Technician diagnosis workspace' })).toBeVisible();
  await page.getByRole('link', { name: 'Operations', exact: true }).click();
  await expect(page.getByRole('table')).toBeVisible({ timeout: 25_000 });
  await expect(page.getByText('Campus switch', { exact: true })).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: testInfo.outputPath('operations-live-fleet.png'), fullPage: true });
  await page.getByRole('button', { name: /Open incidents/ }).click();
  await expect(page.getByRole('heading', { name: 'Incidents', exact: true })).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: testInfo.outputPath('operations-live-incidents.png'), fullPage: true });
  await page.getByRole('button', { name: 'integrations', exact: true }).click();
  await expect(page.getByText('57 catalog entries')).toBeVisible();
});
