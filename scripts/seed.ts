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
  "Synthetic ProView Display Troubleshooting Manual.",
  "If the power indicator is dark, verify the room power source and the documented power cable seating before escalation.",
  "If the display is online but shows no picture, confirm that HDMI 1 is selected and inspect the permitted signal-status reading.",
  "Do not open the enclosure. Create an incident for an authorized technician when power or signal checks do not restore service."
].join("\n\n");

async function main(): Promise<void> {
  const sql = postgres(adminUrl, { max: 1, prepare: false });
  const credentials: Array<{ email: string; password: string }> = [];
  try {
    await sql.begin(async (transaction) => {
      await transaction`
        insert into tenants (id, slug, name, demo_mode)
        values
          (${TEST_TENANT_ALPHA_ID}, 'synthetic-av-lab', 'Synthetic AV Lab', false),
          (${TEST_TENANT_BETA_ID}, 'synthetic-beta-lab', 'Synthetic Beta Lab', false)
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
              firmwareVersion: "1.0.0-synthetic",
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
          (${sourceId}, ${TEST_TENANT_ALPHA_ID}, 'Synthetic ProView Display Manual', 'bundled', null,
           'Original fictional content; all rights reserved',
           array['owner','admin','manager','technician','viewer']::membership_role[])
        on conflict (id) do nothing
      `;
      await transaction`
        insert into document_versions
          (id, tenant_id, source_id, version_label, checksum, parser_version, state, published_at)
        values
          (${versionId}, ${TEST_TENANT_ALPHA_ID}, ${sourceId}, '1.0', ${contentHash}, 'deviceops-text-v1', 'published', now())
        on conflict (id) do nothing
      `;
      await transaction`
        insert into document_chunks
          (id, tenant_id, source_id, source_version_id, page, start_offset, end_offset,
           content, content_hash, embedding, embedding_model, injection_signals)
        values
          (${chunkId}, ${TEST_TENANT_ALPHA_ID}, ${sourceId}, ${versionId}, 1, 0, ${manualText.length},
           ${manualText}, ${contentHash}, ${vectorLiteral(deterministicEmbedding(manualText))}::vector,
           'deviceops-deterministic-mock-v1', ${detectPromptInjection(manualText)})
        on conflict (id) do update
          set content = excluded.content,
              content_hash = excluded.content_hash,
              embedding = excluded.embedding,
              injection_signals = excluded.injection_signals
      `;
    });

    console.log("[db:seed] synthetic tenants, devices, telemetry, and manual seeded");
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
