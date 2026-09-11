export type OperationUser = { displayName: string; tenantName: string; role: string };
export type Device = {
  criticality?: 'standard' | 'critical' | 'unknown';
  id: string; name: string; room: string; kind: string;
  health: 'online' | 'warning' | 'error' | 'offline' | 'unknown';
  reachability: string; auth: string; observedAt: string | null;
  sourceMode: 'simulated' | 'live'; conflict: boolean; metrics: Record<string, unknown>;
};
export type Incident = {
  id: string; summary: string; cause: string; status: string; severity: string;
  deviceIds: string[]; createdAt: string; updatedAt: string;
  diagnosis: Record<string, unknown> | null; report: Record<string, unknown> | null;
  evidence?: Record<string, unknown>[];
};
export type Approval = {
  id: string; incidentId: string; name: string; targetDeviceId: string;
  risk: string; status: string; hash: string; expiresAt: string;
  evidenceIds: string[]; preconditions: unknown; arguments?: Record<string, unknown>;
  policyVersion?: string;
};
export type OperationEvent = { id: string; incidentId: string | null; type: string; createdAt: string; data: Record<string, unknown> };
export type OperationsState = {
  devices: Device[]; incidents: Incident[]; approvals: Approval[]; events: OperationEvent[];
  connectors: { id: string; name: string; category: string; status: string }[];
  runbooks?: { id: string; title: string; text: string; version: string; published: boolean }[];
  notifications?: { id: string; incidentId: string; state: string; attempts: number; lastError: string | null }[];
  discovery: { id: string; name: string; address: string; status: string }[];
  mode: 'fixture' | 'bedrock' | 'gemini'; budget: { spentUsd: number; limitUsd: number; reservedUsd: number };
};
export type Mutation = (path: string, body: Record<string, unknown>, success: string) => Promise<void>;
export function human(value: string | undefined | null) {
  return (value || 'unknown').replaceAll('_', ' ').replaceAll('-', ' ');
}
export function timestamp(value: string | null | undefined) {
  if (!value) return 'No observation';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Unknown time' : date.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
export function object(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
export function text(value: unknown): string {
  return typeof value === 'string' ? value : typeof value === 'number' || typeof value === 'boolean' ? String(value) : '';
}
