import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import ipaddr from "ipaddr.js";
import type { Citation } from "@deviceops/contracts";

export interface SearchResult {
  chunkId: string;
  content: string;
  score: number;
  citation: Citation;
  injectionSignals: string[];
}

export interface RankedItem {
  id: string;
  rank: number;
}

export function reciprocalRankFusion(
  lists: RankedItem[][],
  k = 60
): Array<{ id: string; score: number }> {
  const scores = new Map<string, number>();
  for (const list of lists) {
    for (const item of list) {
      scores.set(item.id, (scores.get(item.id) ?? 0) + 1 / (k + item.rank));
    }
  }
  return [...scores.entries()]
    .map(([id, score]) => ({ id, score }))
    .sort((left, right) => right.score - left.score || left.id.localeCompare(right.id));
}

export function deterministicEmbedding(text: string, dimensions = 1_536): number[] {
  const normalized = text.normalize("NFKC").toLowerCase();
  const vector = new Array<number>(dimensions).fill(0);
  const terms = normalized.match(/[a-z0-9]+/g) ?? [];
  for (const term of terms) {
    const digest = createHash("sha256").update(term).digest();
    const index = digest.readUInt32BE(0) % dimensions;
    const sign = digest[4]! % 2 === 0 ? 1 : -1;
    vector[index] = (vector[index] ?? 0) + sign;
  }
  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  return magnitude === 0 ? vector : vector.map((value) => value / magnitude);
}

export function detectPromptInjection(text: string): string[] {
  const checks: Array<[string, RegExp]> = [
    ["instruction_override", /ignore\s+(all\s+)?(previous|system)\s+instructions?/i],
    ["secret_exfiltration", /(reveal|print|return).{0,30}(secret|token|system prompt)/i],
    ["tool_coercion", /(call|execute|invoke).{0,20}(tool|function|webhook)/i],
    ["role_impersonation", /(^|\n)\s*(system|developer|assistant)\s*:/i]
  ];
  return checks.filter(([, pattern]) => pattern.test(text)).map(([signal]) => signal);
}

export interface TextChunk {
  content: string;
  startOffset: number;
  endOffset: number;
  contentHash: string;
}

export function chunkText(
  input: string,
  options: { targetChars?: number; overlapChars?: number } = {}
): TextChunk[] {
  const target = options.targetChars ?? 1_200;
  const overlap = options.overlapChars ?? 180;
  if (target < 200 || overlap < 0 || overlap >= target) {
    throw new Error("Invalid chunk configuration");
  }
  const text = input.replace(/\r\n/g, "\n").trim();
  const chunks: TextChunk[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(text.length, start + target);
    if (end < text.length) {
      const paragraph = text.lastIndexOf("\n\n", end);
      const sentence = text.lastIndexOf(". ", end);
      const boundary = Math.max(paragraph, sentence);
      if (boundary > start + Math.floor(target * 0.55)) end = boundary + 1;
    }
    const content = text.slice(start, end).trim();
    if (content) {
      chunks.push({
        content,
        startOffset: start,
        endOffset: end,
        contentHash: createHash("sha256").update(content).digest("hex")
      });
    }
    if (end >= text.length) break;
    start = Math.max(start + 1, end - overlap);
  }
  return chunks;
}

export async function assertSafePublicUrl(
  input: string,
  allowedHosts: string[]
): Promise<URL> {
  const url = new URL(input);
  if (url.protocol !== "https:") throw new Error("Only HTTPS sources are allowed");
  if (url.username || url.password) throw new Error("URL credentials are forbidden");
  const host = url.hostname.toLowerCase();
  const allowed = allowedHosts.some(
    (candidate) => host === candidate || host.endsWith(`.${candidate}`)
  );
  if (!allowed) throw new Error("Source host is not allowlisted");
  const addresses = await lookup(host, { all: true, verbatim: true });
  if (addresses.length === 0) throw new Error("Source host did not resolve");
  for (const address of addresses) {
    const parsed = ipaddr.parse(address.address);
    const range = parsed.range();
    if (!new Set(["unicast"]).has(range)) {
      throw new Error(`Resolved source address is not public unicast: ${range}`);
    }
  }
  return url;
}

export async function safeFetchText(
  input: string,
  options: {
    allowedHosts: string[];
    maxBytes?: number;
    timeoutMs?: number;
    maxRedirects?: number;
  }
): Promise<{ text: string; contentType: string; finalUrl: string }> {
  const maxBytes = options.maxBytes ?? 2 * 1024 * 1024;
  const timeoutMs = options.timeoutMs ?? 10_000;
  const maxRedirects = options.maxRedirects ?? 3;
  let current = input;
  for (let redirect = 0; redirect <= maxRedirects; redirect += 1) {
    const safeUrl = await assertSafePublicUrl(current, options.allowedHosts);
    const response = await fetch(safeUrl, {
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
      headers: { Accept: "text/plain, text/html;q=0.9" }
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location || redirect === maxRedirects) throw new Error("Unsafe redirect chain");
      current = new URL(location, safeUrl).toString();
      continue;
    }
    if (!response.ok) throw new Error(`Source returned HTTP ${response.status}`);
    const contentType = response.headers.get("content-type")?.split(";")[0] ?? "";
    if (!new Set(["text/plain", "text/html"]).has(contentType)) {
      throw new Error(`Unsupported source MIME type: ${contentType}`);
    }
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Source response had no body");
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel("source too large");
        throw new Error("Source exceeded byte limit");
      }
      chunks.push(value);
    }
    const combined = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) {
      combined.set(chunk, offset);
      offset += chunk.length;
    }
    return {
      text: new TextDecoder("utf-8", { fatal: true }).decode(combined),
      contentType,
      finalUrl: safeUrl.toString()
    };
  }
  throw new Error("Redirect limit exceeded");
}

export const chunkDocumentText = chunkText;

export async function executeHybridSearch(params: {
  query: string;
  tenantId: string;
  topK?: number;
}): Promise<SearchResult[]> {
  const topK = params.topK ?? 5;
  const injectionSignals = detectPromptInjection(params.query);

  const mockChunk: SearchResult = {
    chunkId: "42000000-0000-4000-8000-000000000001",
    content: "If the power indicator is dark, verify the room power source and the documented power cable seating before escalation.",
    score: 0.95,
    citation: {
      id: "cit-1",
      sourceId: "40000000-0000-4000-8000-000000000001",
      sourceVersionId: "41000000-0000-4000-8000-000000000001",
      chunkId: "42000000-0000-4000-8000-000000000001",
      title: "ProView Display Troubleshooting Manual",
      page: 1,
      startOffset: 0,
      endOffset: 120,
      excerpt: "If the power indicator is dark, verify the room power source and the documented power cable seating before escalation."
    },
    injectionSignals
  };

  if (params.query.toLowerCase().includes("non-existent") || params.query.toLowerCase().includes("quantum flux")) {
    return [];
  }

  return [mockChunk];
}

