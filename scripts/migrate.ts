import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import postgres from "postgres";

const adminUrl =
  process.env.DATABASE_ADMIN_URL ??
  "postgresql://postgres:deviceops_admin_dev@127.0.0.1:5432/deviceops";

async function main(): Promise<void> {
  const sql = postgres(adminUrl, { max: 1, prepare: false });
  try {
    await sql`select pg_advisory_lock(hashtext('deviceops:migrations'))`;
    await sql`
      create table if not exists deviceops_schema_migrations (
        filename text primary key,
        checksum_sha256 text not null,
        applied_at timestamptz not null default now()
      )
    `;

    const migrationDirectory = join(process.cwd(), "drizzle");
    const files = (await readdir(migrationDirectory))
      .filter((file) => file.endsWith(".sql"))
      .sort();

    for (const filename of files) {
      const migration = await readFile(join(migrationDirectory, filename), "utf8");
      const checksum = createHash("sha256").update(migration).digest("hex");
      const [applied] = await sql<Array<{ checksum_sha256: string }>>`
        select checksum_sha256
        from deviceops_schema_migrations
        where filename = ${filename}
      `;

      if (applied) {
        if (applied.checksum_sha256 !== checksum) {
          throw new Error(`Applied migration checksum changed: ${filename}`);
        }
        console.log(`[db:migrate] already applied ${filename}`);
        continue;
      }

      await sql.begin(async (transaction) => {
        await transaction.unsafe(migration);
        await transaction`
          insert into deviceops_schema_migrations (filename, checksum_sha256)
          values (${filename}, ${checksum})
        `;
      });
      console.log(`[db:migrate] applied ${filename}`);
    }
  } finally {
    await sql`select pg_advisory_unlock(hashtext('deviceops:migrations'))`.catch(
      () => undefined
    );
    await sql.end({ timeout: 5 });
  }
}

main().catch((error: unknown) => {
  console.error("[db:migrate] failed", error);
  process.exitCode = 1;
});
