import { randomUUID } from "node:crypto";
import { adminSql } from "@deviceops/db";
import { budget } from "./store.js";
import { z } from "zod";
const RequestSchema = z.array(z.string().min(1).max(4000)).min(1).max(16);
const ResponseSchema = z
  .object({
    vectors: z.array(z.array(z.number().finite()).length(1024)),
    modelId: z.literal("amazon.titan-embed-text-v2:0"),
    inputTokens: z.number().int().nonnegative(),
  })
  .strict();
async function settle(
  id: string,
  cost: number,
  status: "completed" | "unknown",
) {
  await adminSql().begin(async (tx) => {
    const [r] = await tx<
      Array<{ reserved_usd: string }>
    >`update ops_embedding_reservations set status=${status},cost_usd=${cost},completed_at=now() where id=${id} and status='running' returning reserved_usd`;
    if (r)
      await tx`update ops_budget set reserved_usd=greatest(0,reserved_usd-${Number(r.reserved_usd)}),spent_usd=spent_usd+${cost} where id='bedrock'`;
  });
}
export async function recoverEmbeddings() {
  const expired = await adminSql()<
    Array<{ id: string; reserved_usd: string }>
  >`select id,reserved_usd from ops_embedding_reservations where status='running' and lease_until<now()`;
  for (const row of expired)
    await settle(row.id, Number(row.reserved_usd), "unknown");
}
export async function embedTexts(texts: string[], tenantId: string) {
  RequestSchema.parse(texts);
  z.uuid().parse(tenantId);
  if (process.env.AWS_CREDITS_CONFIRMED !== "true")
    throw new Error(
      "Confirm AWS promotional credits before making paid model calls",
    );
  if (
    process.env.OPS_AGENT_MODE !== "bedrock" ||
    !process.env.STRANDS_SERVICE_URL ||
    !process.env.STRANDS_SERVICE_TOKEN
  )
    throw new Error("Semantic embeddings require configured Bedrock mode");
  await budget();
  const reserve = 0.01,
    id = randomUUID(),
    db = adminSql();
  const reserved = await db.begin(async (tx) => {
    const [r] =
      await tx`update ops_budget set reserved_usd=reserved_usd+${reserve} where id='bedrock' and limit_usd-spent_usd-reserved_usd>=${reserve} returning id`;
    if (!r) return false;
    await tx`insert into ops_embedding_reservations(id,tenant_id,status,reserved_usd,lease_until) values(${id},${tenantId},'running',${reserve},now()+interval '45 seconds')`;
    return true;
  });
  if (!reserved) throw new Error("Embedding budget exhausted");
  let cost = reserve,
    status: "completed" | "unknown" = "unknown";
  try {
    const r = await fetch(`${process.env.STRANDS_SERVICE_URL}/embed`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${process.env.STRANDS_SERVICE_TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ texts }),
      redirect: "error",
      signal: AbortSignal.timeout(30000),
    });
    if (!r.ok) throw new Error(`Embedding service unavailable (${r.status})`);
    const result = ResponseSchema.parse(await r.json());
    if (result.vectors.length !== texts.length)
      throw new Error("Embedding result count mismatch");
    cost =
      (result.inputTokens *
        Number(process.env.TITAN_INPUT_USD_PER_MILLION ?? 0.02)) /
      1e6;
    status = "completed";
    return result;
  } finally {
    await settle(id, cost, status);
  }
}
export function cosine(a: number[], b: number[]) {
  if (a.length !== b.length) return 0;
  let dot = 0,
    aa = 0,
    bb = 0;
  for (let n = 0; n < a.length; n++) {
    dot += a[n]! * b[n]!;
    aa += a[n]! ** 2;
    bb += b[n]! ** 2;
  }
  return aa && bb ? dot / Math.sqrt(aa * bb) : 0;
}
