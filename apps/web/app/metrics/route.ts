import { metrics } from '@deviceops/observability';

export function GET() {
  return new Response(metrics.toPrometheus(), { headers: { 'Content-Type': 'text/plain; version=0.0.4', 'Cache-Control': 'no-store' } });
}
