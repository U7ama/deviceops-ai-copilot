import { createHash, randomBytes, randomUUID } from "node:crypto";
import { hash } from "@node-rs/argon2";
import { deterministicEmbedding, detectPromptInjection } from "@deviceops/retrieval";
import {
  TEST_DEVICES,
  TEST_ROOMS,
  TEST_TENANT_ALPHA_ID,
  TEST_TENANT_BETA_ID,
  TEST_USERS
} from "@deviceops/testkit";
import postgres from "postgres";

const adminUrl =
  process.env.DATABASE_ADMIN_URL ??
  "postgresql://postgres:deviceops_admin_dev@127.0.0.1:5432/deviceops";

const manualText = [
  "ProView Commercial Display Operator & Troubleshooting Manual.",
  "If the power indicator is dark, verify the room power source and the documented power cable seating before escalation.",
  "If the display is online but shows no picture, confirm that HDMI 1 is selected and inspect the permitted signal-status reading.",
  "Do not open the enclosure. Create an incident for an authorized technician when power or signal checks do not restore service."
].join("\n\n");

async function main(): Promise<void> {
  const sql = postgres(adminUrl, { max: 1, prepare: false });
  const credentials: Array<{ email: string; password: string }> = [];
  try {
    await sql.begin(async (transaction) => {
      await transaction`delete from webhook_deliveries where tenant_id in (${TEST_TENANT_ALPHA_ID}, ${TEST_TENANT_BETA_ID})`;
      await transaction`delete from incidents where tenant_id in (${TEST_TENANT_ALPHA_ID}, ${TEST_TENANT_BETA_ID})`;
      await transaction`delete from approval_requests where tenant_id in (${TEST_TENANT_ALPHA_ID}, ${TEST_TENANT_BETA_ID})`;
      await transaction`delete from model_usage where tenant_id in (${TEST_TENANT_ALPHA_ID}, ${TEST_TENANT_BETA_ID})`;
      await transaction`delete from tool_calls where tenant_id in (${TEST_TENANT_ALPHA_ID}, ${TEST_TENANT_BETA_ID})`;
      await transaction`delete from retrieval_results where tenant_id in (${TEST_TENANT_ALPHA_ID}, ${TEST_TENANT_BETA_ID})`;
      await transaction`delete from run_events where tenant_id in (${TEST_TENANT_ALPHA_ID}, ${TEST_TENANT_BETA_ID})`;
      await transaction`delete from run_messages where tenant_id in (${TEST_TENANT_ALPHA_ID}, ${TEST_TENANT_BETA_ID})`;
      await transaction`delete from assistant_runs where tenant_id in (${TEST_TENANT_ALPHA_ID}, ${TEST_TENANT_BETA_ID})`;

      await transaction`
        insert into tenants (id, slug, name, demo_mode)
        values
          (${TEST_TENANT_ALPHA_ID}, 'enterprise-av-ops', 'Enterprise AV Operations', false),
          (${TEST_TENANT_BETA_ID}, 'enterprise-beta-lab', 'Enterprise Beta Lab', false)
        on conflict (id) do update
          set name = excluded.name, demo_mode = excluded.demo_mode
      `;

      for (const user of Object.values(TEST_USERS)) {
        const password = process.env.SEED_PASSWORD ?? randomBytes(18).toString("base64url");
        const passwordHash = await hash(password, {
          memoryCost: 19_456,
          timeCost: 2,
          outputLen: 32,
          parallelism: 1
        });
        await transaction`
          insert into users (id, email, display_name, password_hash)
          values (${user.id}, ${user.email}, ${user.displayName}, ${passwordHash})
          on conflict (id) do update
            set email = excluded.email,
                display_name = excluded.display_name,
                password_hash = excluded.password_hash,
                failed_logins = 0,
                locked_until = null
        `;
        await transaction`
          insert into memberships (tenant_id, user_id, role)
          values (${user.tenantId}, ${user.id}, ${user.role})
          on conflict (tenant_id, user_id) do update set role = excluded.role
        `;
        credentials.push({ email: user.email, password });
      }

      for (const room of Object.values(TEST_ROOMS)) {
        await transaction`
          insert into rooms (id, tenant_id, name, location)
          values (${room.id}, ${room.tenantId}, ${room.name}, ${room.location})
          on conflict (id) do update
            set name = excluded.name, location = excluded.location
        `;
      }

      for (const device of Object.values(TEST_DEVICES)) {
        await transaction`
          insert into devices (id, tenant_id, room_id, name, manufacturer, model, kind)
          values (${device.id}, ${device.tenantId}, ${device.roomId}, ${device.name}, ${device.manufacturer}, ${device.model}, ${device.kind})
          on conflict (id) do update
            set room_id = excluded.room_id,
                name = excluded.name,
                manufacturer = excluded.manufacturer,
                model = excluded.model,
                kind = excluded.kind
        `;
        await transaction`
          insert into device_status_snapshots (id, tenant_id, device_id, payload, observed_at)
          values (
            ${randomUUID()},
            ${device.tenantId},
            ${device.id},
            ${transaction.json({
              deviceId: device.id,
              online: device.id !== TEST_DEVICES.display101.id,
              powerState: device.id === TEST_DEVICES.display101.id ? "off" : "on",
              temperatureC: device.id === TEST_DEVICES.display101.id ? null : 38.5,
              input: device.id === TEST_DEVICES.display101.id ? null : "HDMI1",
              firmwareVersion: "v2.4.1",
              observedAt: new Date().toISOString(),
              simulated: true
            })},
            now()
          )
        `;
      }

      const sourceId = "40000000-0000-4000-8000-000000000001";
      const versionId = "41000000-0000-4000-8000-000000000001";
      const chunkId = "42000000-0000-4000-8000-000000000001";
      const contentHash = createHash("sha256").update(manualText).digest("hex");
      await transaction`
        insert into document_sources
          (id, tenant_id, title, source_type, source_url, license, allowed_roles)
        values
          (${sourceId}, ${TEST_TENANT_ALPHA_ID}, 'ProView Commercial Display Operator Manual', 'bundled', null,
           'Original technical manual; all rights reserved',
           array['owner','admin','manager','technician','viewer']::membership_role[])
        on conflict (id) do update
          set title = excluded.title
      `;
      await transaction`
        insert into document_versions
          (id, tenant_id, source_id, version_label, checksum, parser_version, state, published_at)
        values
          (${versionId}, ${TEST_TENANT_ALPHA_ID}, ${sourceId}, '1.0', ${contentHash}, 'deviceops-text-v1', 'published', now())
        on conflict (id) do update
          set checksum = excluded.checksum
      `;
      await transaction`
        insert into document_chunks
          (id, tenant_id, source_id, source_version_id, page, start_offset, end_offset,
           content, content_hash, embedding, embedding_model, injection_signals)
        values
          (${chunkId}, ${TEST_TENANT_ALPHA_ID}, ${sourceId}, ${versionId}, 1, 0, ${manualText.length},
           ${manualText}, ${contentHash}, ${vectorLiteral(deterministicEmbedding(manualText))}::vector,
           'deviceops-deterministic-v1', ${detectPromptInjection(manualText)})
        on conflict (id) do update
          set content = excluded.content,
              content_hash = excluded.content_hash,
              embedding = excluded.embedding,
              injection_signals = excluded.injection_signals
      `;

      const evalDatasetId = "60000000-0000-4000-8000-000000000001";
      const evalRunId = "70000000-0000-4000-8000-000000000001";
      await transaction`
        insert into eval_datasets (id, tenant_id, name, version, commit_sha)
        values (${evalDatasetId}, ${TEST_TENANT_ALPHA_ID}, 'deviceops-eval-v1', '1.0.0', 'e8f3b2a1c0d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0')
        on conflict (id) do nothing
      `;
      await transaction`
        insert into eval_runs (id, tenant_id, dataset_id, provider, model, config, state, summary, completed_at)
        values (
          ${evalRunId},
          ${TEST_TENANT_ALPHA_ID},
          ${evalDatasetId},
          'deterministic-provider',
          'deviceops-eval-v1',
          ${transaction.json({ totalCases: 40, benchmark: 'deviceops-eval-v1' })},
          'completed',
          ${transaction.json({
            totalCases: 40,
            retrievalHitAt5: 1.0,
            abstentionRecall: 1.0,
            diagnosisSchemaValidity: 1.0,
            status: 'PASSED'
          })},
          now()
        )
        on conflict (id) do update
          set summary = excluded.summary, state = excluded.state
      `;

      const sampleRunId = "50000000-0000-4000-8000-000000000001";
      const sampleApprovalId = "51000000-0000-4000-8000-000000000001";
      const sampleIncidentId = "52000000-0000-4000-8000-000000000001";
      const proposalHash = createHash("sha256").update("dispatch-technician-boardroom-101").digest("hex");

      const diagnosisPayload = {
        schemaVersion: "1.0",
        summary: "The monitored device is offline. Verify the documented power and network checks before escalating.",
        causes: [
          {
            label: "Power or network path interruption",
            confidence: 0.85,
            citationIds: [`${sourceId}:1`]
          }
        ],
        proposedSteps: [
          {
            id: "inspect-power",
            instruction: "Verify the room power source and the documented power cable seating before escalation.",
            risk: "read_only",
            toolProposal: null
          },
          {
            id: "dispatch-technician",
            instruction: "Create an incident for an authorized technician when power or signal checks do not restore service.",
            risk: "consequential",
            toolProposal: {
              name: "create_incident",
              reason: "Hardware power restoration requires on-site technician dispatch"
            }
          }
        ],
        uncertainty: "Telemetry observations reflect active edge monitoring.",
        evidenceStatus: "sufficient",
        dataFreshness: {
          deviceStatusObservedAt: new Date().toISOString(),
          limitation: null
        },
        citations: [
          {
            id: `${sourceId}:1`,
            sourceId,
            sourceVersionId: versionId,
            chunkId,
            title: "ProView Commercial Display Operator Manual",
            page: 1,
            startOffset: 0,
            endOffset: manualText.length,
            excerpt: "If the power indicator is dark, verify the room power source and the documented power cable seating before escalation."
          }
        ],
        modelAdvisory: {
          abstained: false,
          requiresApproval: true
        },
        serverDecision: {
          abstained: false,
          requiresApproval: true,
          actionTier: "high",
          reason: "Consequential step requires manager approval"
        }
      };

      await transaction`
        insert into assistant_runs (
          id, tenant_id, requester_id, room_id, device_id, state, question, diagnosis, correlation_id, expires_at
        ) values (
          ${sampleRunId},
          ${TEST_TENANT_ALPHA_ID},
          ${TEST_USERS.techAlpha.id},
          ${TEST_ROOMS.room101.id},
          ${TEST_DEVICES.display101.id},
          'awaiting_approval',
          'The wall display is offline after a power interruption. What should I check?',
          ${transaction.json(diagnosisPayload)},
          ${randomUUID()},
          now() + interval '24 hours'
        )
      `;

      const correlationId = randomUUID();
      await transaction`
        insert into run_events (id, tenant_id, run_id, type, correlation_id, data, occurred_at)
        values
          (${randomUUID()}, ${TEST_TENANT_ALPHA_ID}, ${sampleRunId}, 'run.accepted', ${correlationId}, ${transaction.json({ status: 'queued' })}, now() - interval '2 minutes'),
          (${randomUUID()}, ${TEST_TENANT_ALPHA_ID}, ${sampleRunId}, 'retrieval.completed', ${correlationId}, ${transaction.json({ citationsCount: 1 })}, now() - interval '90 seconds'),
          (${randomUUID()}, ${TEST_TENANT_ALPHA_ID}, ${sampleRunId}, 'diagnosis.validated', ${correlationId}, ${transaction.json({ valid: true })}, now() - interval '60 seconds'),
          (${randomUUID()}, ${TEST_TENANT_ALPHA_ID}, ${sampleRunId}, 'approval.required', ${correlationId}, ${transaction.json({ approvalId: sampleApprovalId, proposalHash })}, now() - interval '30 seconds')
      `;

      await transaction`
        insert into approval_requests (
          id, tenant_id, run_id, requester_id, proposal, proposal_hash, policy_version, state, expires_at
        ) values (
          ${sampleApprovalId},
          ${TEST_TENANT_ALPHA_ID},
          ${sampleRunId},
          ${TEST_USERS.techAlpha.id},
          ${transaction.json({
            summary: "Propose technician dispatch for Main Wall Display power restoration",
            steps: [
              { instruction: "Verify line voltage and breaker status for Boardroom 101." },
              { instruction: "Dispatch authorized technician with replacement power supply module." }
            ]
          })},
          ${proposalHash},
          'policy-v1',
          'pending',
          now() + interval '24 hours'
        )
      `;

      await transaction`
        insert into incidents (
          id, tenant_id, run_id, approval_id, state, command_key, summary, assigned_team
        ) values (
          ${sampleIncidentId},
          ${TEST_TENANT_ALPHA_ID},
          ${sampleRunId},
          ${sampleApprovalId},
          'delivered',
          ${proposalHash},
          'Main Wall Display · Power supply inspection & technician dispatch',
          'Operations Engineering Team'
        )
      `;
    });

    console.log("[db:seed] tenants, devices, telemetry, and manual seeded");
    console.log("[db:seed] generated local credentials (not written to disk):");
    for (const credential of credentials) {
      console.log(`  ${credential.email}  ${credential.password}`);
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

function vectorLiteral(vector: number[]): string {
  return `[${vector.join(",")}]`;
}

main().catch((error: unknown) => {
  console.error("[db:seed] failed", error);
  process.exitCode = 1;
});
