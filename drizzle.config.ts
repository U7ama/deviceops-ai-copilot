import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./packages/db/src/schema.ts",
  out: "./packages/db/migrations",
  dbCredentials: {
    url:
      process.env.DATABASE_ADMIN_URL ??
      "postgresql://postgres:deviceops_admin_dev@localhost:5432/deviceops"
  },
  strict: true,
  verbose: true
});
