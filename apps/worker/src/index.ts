import { processRun, resetRunForRetry } from "@deviceops/core";
import { adminSql, closeDatabase, queue } from "@deviceops/db";
import { logStructured, metrics } from "@deviceops/observability";
import type { JobWithMetadata } from "pg-boss";

interface ProcessRunJob {
  runId: string;
  tenantId: string;
  requesterId: string;
}

const REQUIRED_ENV = ["DATABASE_URL", "DATABASE_ADMIN_URL"] as const;
for (const name of REQUIRED_ENV) {
  if (!process.env[name]) throw new Error(`Missing required environment variable: ${name}`);
}

const boss = await queue();
await boss.createQueue("process-run-dead-letter", {
  retentionSeconds: 7 * 24 * 60 * 60
});
await boss.createQueue("process-run", {
  retryLimit: 5,
  retryDelay: 2,
  retryBackoff: true,
  retryDelayMax: 60,
  expireInSeconds: 90,
  retentionSeconds: 24 * 60 * 60,
  deadLetter: "process-run-dead-letter"
});

await boss.work<ProcessRunJob, { state: string }, {
  batchSize: 1;
  includeMetadata: true;
  pollingIntervalSeconds: 1;
}>(
  "process-run",
  { batchSize: 1, includeMetadata: true, pollingIntervalSeconds: 1 },
  async (jobs: JobWithMetadata<ProcessRunJob>[]) => {
    const job = jobs[0];
    if (!job) return { state: "empty" };
    try {
      const state = await processRun(job.data);
      logStructured("worker.run.processed", { jobId: job.id, runId: job.data.runId, state });
      return { state };
    } catch (error) {
      const willRetry = job.retryCount < job.retryLimit;
      if (willRetry) {
        await resetRunForRetry({ ...job.data, retryCount: job.retryCount + 1 });
      }
      metrics.increment("deviceops_worker_failures_total", { queue: "process-run", willRetry });
      logStructured("worker.run.failed", {
        jobId: job.id,
        runId: job.data.runId,
        retryCount: job.retryCount,
        willRetry,
        error: error instanceof Error ? error.message : "unknown"
      }, "error");
      throw error;
    }
  }
);

async function recoverDurableRequests(): Promise<void> {
  const rows = await adminSql()<
    Array<{ outbox_id: string; run_id: string; tenant_id: string; requester_id: string }>
  >`
    select o.id as outbox_id, r.id as run_id, r.tenant_id, r.requester_id
    from outbox_events o
    join assistant_runs r on r.id = o.aggregate_id and r.tenant_id = o.tenant_id
    where o.event_type = 'run.requested'
      and o.published_at is null
      and o.available_at <= now()
      and r.state = 'queued'
      and r.expires_at > now()
    order by o.created_at asc
    limit 100
  `;
  for (const row of rows) {
    const jobId = await boss.send("process-run", {
      runId: row.run_id,
      tenantId: row.tenant_id,
      requesterId: row.requester_id
    }, { singletonKey: row.run_id, retryLimit: 5, retryBackoff: true });
    if (jobId) {
      await adminSql()`
        update outbox_events set published_at = now(), attempts = attempts + 1
        where id = ${row.outbox_id} and published_at is null
      `;
    }
  }
}

await recoverDurableRequests();
const recoveryTimer = setInterval(() => {
  void recoverDurableRequests().catch((error: unknown) => {
    logStructured("worker.outbox.recovery_failed", {
      error: error instanceof Error ? error.message : "unknown"
    }, "error");
  });
}, 5_000);
recoveryTimer.unref();

logStructured("worker.ready", { queues: ["process-run"] });

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    clearInterval(recoveryTimer);
    void closeDatabase().finally(() => process.exit(0));
  });
}
