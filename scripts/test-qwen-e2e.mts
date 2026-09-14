import { adminSql, closeDatabase } from '@deviceops/db';
import { transaction, SERVICE_ID, readState } from '../packages/operations/src/store.js';
import {
  injectScenario,
  ingest,
  simulatorObservations,
  detect,
  investigate,
  tickTenant,
} from '@deviceops/operations';

async function run() {
  console.log('=== [1/6] INITIALIZING QWEN END-TO-END VERIFICATION ===');
  const [tenant] = await adminSql()<Array<{ id: string }>>`
    select m.tenant_id as id from memberships m
    join users u on u.id = m.user_id
    where u.email = 'usamaaslam8726@gmail.com'
    limit 1
  `;
  if (!tenant) throw new Error('Primary test tenant not found');
  console.log(`Tenant ID: ${tenant.id}`);

  // Set budget limit
  await adminSql()`update ops_budget set limit_usd = greatest(limit_usd, 6) where id = 'bedrock'`;
  const [b0] = await adminSql()<Array<{ limit_usd: string; spent_usd: string; reserved_usd: string }>>`
    select limit_usd, spent_usd, reserved_usd from ops_budget where id = 'bedrock'
  `;
  console.log(`Initial Budget: limit=$${b0.limit_usd}, spent=$${b0.spent_usd}, reserved=$${b0.reserved_usd}`);

  console.log('\n=== [2/6] INJECTING FAULT SCENARIO & DETECTING INCIDENT ===');
  const incidentId = await transaction(tenant.id, SERVICE_ID, (s) => {
    if (s.controls) s.controls = { ...s.controls, stopped: false, detectorMode: 'observe' };
    const now = Date.now();
    injectScenario(s, 'service_hang', now);
    for (let n = 3; n >= 0; n--) {
      const at = now - n * 5000;
      ingest(s, simulatorObservations(s, at), at);
      detect(s, at);
    }
    const i = s.incidents.filter((i) => i.status === 'detected').at(-1);
    if (!i) throw new Error('No incident detected');
    return i.id;
  });
  console.log(`Incident Created: ${incidentId} (status: detected)`);

  console.log('\n=== [3/6] DISPATCHING INVESTIGATION TO STRANDS & QWEN3.8-FLASH ===');
  const startTime = Date.now();
  console.log('Invoking investigate() — this connects via MCP to Qwen3.8-Flash...');
  
  // Call investigate directly or let worker handle
  const invPromise = investigate(tenant.id, incidentId);

  // Poll state until investigation completes or times out (max 120s)
  let incidentState: any = null;
  for (let second = 0; second < 120; second += 2) {
    await new Promise((r) => setTimeout(r, 2000));
    incidentState = await transaction(tenant.id, SERVICE_ID, (s) => {
      const inc = s.incidents.find((i) => i.id === incidentId);
      return inc ? { ...inc } : null;
    }, true);

    if (!incidentState) break;
    const elapsed = Math.round((Date.now() - startTime) / 1000);
    console.log(`  [+${elapsed}s] Incident status: ${incidentState.status}`);
    if (['proposed', 'diagnosed', 'awaiting_approval', 'executing', 'resolved', 'escalated', 'cancelled'].includes(incidentState.status)) {
      break;
    }
  }

  // Await the investigation promise in case it's still running
  try {
    await invPromise;
  } catch (err) {
    console.log('investigate promise returned:', err instanceof Error ? err.message : String(err));
  }

  const durationMs = Date.now() - startTime;
  console.log(`Investigation stage ended after ${durationMs}ms`);

  console.log('\n=== [4/6] ADVANCING STATE MACHINE WITH TICKS ===');
  for (let tick = 1; tick <= 5; tick++) {
    await tickTenant(tenant.id);
    const inc = await transaction(tenant.id, SERVICE_ID, (s) => s.incidents.find((i) => i.id === incidentId), true);
    console.log(`  Tick ${tick}: status = ${inc?.status}`);
    if (['resolved', 'escalated', 'cancelled', 'awaiting_approval'].includes(inc?.status || '')) {
      break;
    }
    await new Promise((r) => setTimeout(r, 1500));
  }

  console.log('\n=== [5/6] FETCHING FULL VERIFICATION DATA ===');
  const fullState = await transaction(tenant.id, SERVICE_ID, (s) => {
    const inc = s.incidents.find((i) => i.id === incidentId)!;
    const approvals = s.approvals.filter((a) => a.incidentId === incidentId);
    const commands = s.commands.filter((c) => c.incidentId === incidentId);
    const events = s.events.filter((e) => e.incidentId === incidentId);
    return { inc, approvals, commands, events };
  }, true);

  const [invRecord] = await adminSql()<Array<any>>`
    select id, status, tool_calls, tool_limit, reserved_usd, error, created_at, completed_at
    from ops_invocations
    where incident_id = ${incidentId}
    order by created_at desc limit 1
  `;

  const [bFinal] = await adminSql()<Array<{ limit_usd: string; spent_usd: string; reserved_usd: string }>>`
    select limit_usd, spent_usd, reserved_usd from ops_budget where id = 'bedrock'
  `;

  const report = {
    test: 'qwen3.8-flash-end-to-end',
    tenantId: tenant.id,
    incidentId,
    durationMs,
    incidentStatus: fullState.inc.status,
    summary: fullState.inc.summary,
    cause: fullState.inc.cause,
    diagnosis: fullState.inc.diagnosis ? {
      provider: fullState.inc.diagnosis.provider,
      modelId: fullState.inc.diagnosis.modelId,
      usage: fullState.inc.diagnosis.usage,
      toolCalls: fullState.inc.diagnosis.toolCalls,
      action: fullState.inc.diagnosis.action,
      uncertainty: fullState.inc.diagnosis.uncertainty,
      enterprise: fullState.inc.diagnosis.enterprise,
    } : null,
    approvalsCount: fullState.approvals.length,
    approvals: fullState.approvals,
    commandsCount: fullState.commands.length,
    invocationRecord: invRecord,
    budgetSpent: {
      initialSpent: b0.spent_usd,
      finalSpent: bFinal.spent_usd,
      deltaUsd: (Number(bFinal.spent_usd) - Number(b0.spent_usd)).toFixed(6),
    },
    eventsRecorded: fullState.events.map((e) => ({ type: e.type, at: e.created_at })),
  };

  console.log('\n=== [6/6] FINAL VERIFICATION REPORT ===');
  console.log(JSON.stringify(report, null, 2));
}

run()
  .catch((err) => {
    console.error('FAILED WITH ERROR:', err);
    process.exit(1);
  })
  .finally(async () => {
    await closeDatabase();
  });
