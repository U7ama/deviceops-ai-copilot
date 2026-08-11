import { adminSql } from '@deviceops/db';
import { json, problemFromError, requestMetadata } from '@/lib/http';
import { verifySignedWebhook } from '@/lib/webhook';

export async function POST(request: Request) {
  const metadata = requestMetadata(request);
  try {
    const { envelope, payload } = await verifySignedWebhook(request);
    const incidentId = typeof payload.incidentId === 'string' ? payload.incidentId : '';
    const status = payload.status === 'delivered' ? 'delivered' : payload.status === 'retrying' ? 'retrying' : '';
    if (!incidentId || !status) return new Response(JSON.stringify({ code: 'ACK_INVALID' }), { status: 400, headers: { 'content-type': 'application/json' } });
    const sql = adminSql();
    const [updated] = await sql<Array<{ id: string }>>`
      update webhook_deliveries set state = ${status}, acknowledged_at = now()
      where id = ${envelope.deliveryId} and incident_id = ${incidentId}
      returning id
    `;
    if (!updated) return new Response(JSON.stringify({ code: 'DELIVERY_NOT_FOUND' }), { status: 404, headers: { 'content-type': 'application/json' } });
    await sql`update incidents set state = ${status}, updated_at = now() where id = ${incidentId} and state in ('dispatching','retrying')`;
    return json({ acknowledged: true, deliveryId: envelope.deliveryId, status }, metadata);
  } catch (error) { return problemFromError(error, metadata); }
}
