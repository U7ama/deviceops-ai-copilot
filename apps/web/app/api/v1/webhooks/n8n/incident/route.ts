import { randomUUID } from 'node:crypto';
import { adminSql, appendAuditEvent } from '@deviceops/db';
import { DomainError } from '@deviceops/core';
import { logStructured } from '@deviceops/observability';
import { json, problemFromError, requestMetadata } from '@/lib/http';
import { verifySignedWebhook } from '@/lib/webhook';

export async function POST(request: Request) {
  const metadata = requestMetadata(request);
  try {
    const { envelope, payload } = await verifySignedWebhook(request);
    const incidentId = typeof payload.incidentId === 'string' ? payload.incidentId : '';
    if (!incidentId) return new Response(JSON.stringify({ code: 'INCIDENT_REQUIRED' }), { status: 400, headers: { 'content-type': 'application/json' } });
    const sql = adminSql();
    const result = await sql.begin(async (transaction) => {
      const [incident] = await transaction<Array<{ id: string; tenant_id: string; state: string }>>`select id, tenant_id, state from incidents where id = ${incidentId} for update`;
      if (!incident) throw new DomainError('INCIDENT_NOT_FOUND', 'Incident not found', 404);
      const [delivery] = await transaction<Array<{ id: string }>>`
        insert into webhook_deliveries (id, tenant_id, incident_id, nonce, signature, state)
        values (${envelope.deliveryId}, ${incident.tenant_id}, ${incident.id}, ${envelope.nonce}, ${envelope.signature}, 'received')
        on conflict (id, nonce) do nothing returning id
      `;
      if (!delivery) return { duplicate: true, tenantId: incident.tenant_id };
      if (['approved', 'retrying'].includes(incident.state)) await transaction`update incidents set state = 'dispatching', updated_at = now() where id = ${incident.id}`;
      await appendAuditEvent(transaction, { tenantId: incident.tenant_id, actorId: null, action: 'webhook.received', targetType: 'incident', targetId: incident.id, metadata: { deliveryId: envelope.deliveryId } });
      return { duplicate: false, tenantId: incident.tenant_id };
    });
    logStructured('webhook.incident.accepted', { deliveryId: envelope.deliveryId, incidentId, duplicate: result.duplicate });
    return json({ accepted: true, duplicate: result.duplicate, deliveryId: envelope.deliveryId }, metadata, 202);
  } catch (error) { return problemFromError(error, metadata); }
}
