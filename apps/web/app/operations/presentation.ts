import type { Device } from './types';
export const views = ['overview','incidents','fleet','approvals','knowledge','admin'] as const;
export type View = typeof views[number];
export function readLocation(search:string){const params=new URLSearchParams(search);const raw=params.get('view')||'overview';const aliases:Record<string,View>={enterprise:'overview',discovery:'admin',integrations:'admin'};return {view:aliases[raw]??(views.includes(raw as View)?raw as View:'overview'),incident:params.get('incident')||'',section:params.get('section')||(raw==='enterprise'?'anomalies':raw==='discovery'?'discovery':raw==='integrations'?'connectors':'')};}
export function isStale(device:Pick<Device,'observedAt'|'pollIntervalMs'>,now=Date.now()){return !device.observedAt||!Number.isFinite(Date.parse(device.observedAt))||now-Date.parse(device.observedAt)>3*(device.pollIntervalMs??5000);}
export function healthLabel(value:string){return ({online:'Operational',warning:'Degraded',error:'Fault',offline:'Health unavailable — unreachable',unknown:'Health unknown'} as Record<string,string>)[value]??'Health unknown';}
export function cleanSummary(summary: string | null | undefined): string {
  if (!summary) return '';
  return summary
    // 1. Parenthesized/bracketed lists of observations/evidence with UUIDs
    .replace(/\s*[\(\[]\s*(?:observations?|evidence)?[\s,0-9a-f-]{20,}[\)\]]/gi, '')
    // 2. Parenthesized/bracketed full UUID e.g. (8a04af0f-762b-46ac-89c9-b03b9533fdb7)
    .replace(/\s*[\(\[][0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[\)\]]/gi, '')
    // 3. Parenthesized/bracketed short hex ID e.g. (1d507fec), (2ce9396a), (3540ad09)
    .replace(/\s*[\(\[][0-9a-f]{6,16}[\)\]]/gi, '')
    // 4. 'as evidenced by observations <uuid> through <uuid>' or variations
    .replace(/,?\s*(?:as\s+evidenced\s+by\s+)?observations?\s+[0-9a-f-]{36}(?:\s*(?:through|to|-)\s*[0-9a-f-]{36})?/gi, '')
    // 5. Any leftover 'observations through' or 'observations <uuid>'
    .replace(/,?\s*observations?\s+(?:through\b|[0-9a-f-]{36})/gi, '')
    // 6. Citations like citations: <uuid> or citation <uuid>
    .replace(/\bcitations?:\s*[0-9a-f-]{8,36}\b/gi, '')
    // 7. Any standalone UUIDs
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '')
    // 8. Clean empty parentheses/brackets and lingering punctuation
    .replace(/\s*[\(\[]\s*(?:observations?|evidence)?\s*[,;\s]*[\)\]]/gi, '')
    .replace(/[\(\[]\s*[\)\]]/g, '')
    .replace(/,\s*,+/g, ',')
    .replace(/\s+([.,;:!?])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim();
}
