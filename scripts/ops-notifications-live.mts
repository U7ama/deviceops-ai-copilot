import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { adminSql, closeDatabase } from '@deviceops/db';
import { dispatchNotifications } from '../packages/operations/src/notifications.js';

// Local n8n + Mailpit only. Run inside the demo app container with its configured secrets.
const mailpit = process.env.OPS_TEST_MAILPIT_URL ?? 'http://mailpit:8025';
const db = adminSql();
const id = randomUUID();
const summary = `Notification integration ${id}`;
try {
  assert.ok(process.env.OPS_N8N_WEBHOOK_URL, 'Configure the local n8n webhook first');
  const [tenant] = await db`select id from tenants order by name limit 1`;
  assert.ok(tenant, 'Seed the local database first');
  await db`insert into ops_notifications(id,tenant_id,incident_id,payload) values(${id},${tenant.id},${randomUUID()},${db.json({summary, incidentId:randomUUID(), status:'resolved', report:{summary:'Local integration fixture'}})})`;
  await dispatchNotifications([id]);
  let state = '';
  for (let i = 0; i < 60; i++) {
    const [row] = await db`select state from ops_notifications where id=${id}`;
    state = row.state;
    if (state === 'delivered') break;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  assert.equal(state, 'delivered', 'Workflow must send and acknowledge delivery');
  const response = await fetch(`${mailpit}/api/v1/messages`);
  assert.ok(response.ok);
  const data = await response.json() as {messages: Array<{Subject:string}>};
  assert.equal(data.messages.filter(message => message.Subject.includes(id)).length, 1);
  console.log('PASS core dispatch → n8n claim → exactly one Mailpit message → signed core acknowledgement');
} finally {
  await db`delete from ops_notifications where id=${id}`;
  await closeDatabase();
}
