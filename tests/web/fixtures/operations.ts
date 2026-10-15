import type { Page } from '@playwright/test';

// UI contract fixtures; no backend or model verification is implied.
export const now = new Date().toISOString();
export const approval = { id: 'approval-1', incidentId: 'incident-1', name: 'restart_switch', targetDeviceId: 'switch-1', risk: 'approval_required', status: 'pending', hash: 'exact-server-proposal-hash', expiresAt: new Date(Date.now() + 1_800_000).toISOString(), evidenceIds: ['observation-1'], preconditions: { generation: 1, sourceMode: 'simulated', kind: 'switch' }, policyVersion: 'test-policy-1' };
export function fixture() {
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


export async function mockOperations(page: Page, role = 'manager', state = fixture()) {
  const actions: { path: string; body: Record<string, unknown>; csrf: string | undefined; key: string | undefined }[] = [];
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === '/api/v1/auth/me') return route.fulfill({ json: { user: { displayName: 'Test Manager', tenantName: 'Synthetic UI Test', role } } });
    if (path === '/api/v1/auth/csrf') return route.fulfill({ json: { csrfToken: 'test-csrf-token' } });
    if(path === '/api/v2/enterprise')return route.fulfill({json:{topology:[],impact:[],controls:{stopped:false,detectorMode:'observe',replayVerified:false},anomalies:[],baselines:[],artifacts:[],analyses:[],memory:{retrievalMode:'lexical-only',results:[]},providers:{reasoning:'fixture'}}});
    if (path === '/api/v2/state') return route.fulfill({ json: state });
    if (request.method() === 'POST') {
      actions.push({ path, body: request.postDataJSON() as Record<string, unknown>, csrf: request.headers()['x-csrf-token'], key: request.headers()['idempotency-key'] });
      return route.fulfill({ json: { accepted: true } });
    }
    return route.fulfill({ status: 404, json: { detail: 'Unexpected test request' } });
  });
  return actions;
}
