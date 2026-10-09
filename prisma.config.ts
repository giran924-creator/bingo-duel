import "dotenv/config";
import { defineConfig } from "prisma/config";
import { PrismaPg } from "@prisma/adapter-pg";
// Prisma 6 JS schema introspection selects PostgreSQL catalog `name` columns,
// which adapter-pg does not deserialize. Cast only these two catalog projections
// to text in the local migration adapter; application queries are unaffected.
class CloudSchemaAdapter extends PrismaPg {
  async connect() {
    const adapter = await super.connect();
    const query = adapter.queryRaw.bind(adapter);
    adapter.queryRaw = (q) =>
      query({
        ...q,
        sql: q.sql
          .replaceAll(
            "tbl.relname AS table_name",
            "tbl.relname::text AS table_name",
          )
          .replaceAll(
            "namespace.nspname AS table_namespace",
            "namespace.nspname::text AS table_namespace",
          ),
      });
    return adapter;
  }
}
// Local fallback for cloud machines without Prisma binary-host access.
// Production migrations use the default stable native schema engine.
const jsSchema =
  process.env.PRISMA_JS_SCHEMA_ENGINE === "true" &&
  process.env.NODE_ENV !== "production";
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations", seed: "tsx prisma/seed.ts" },
  ...(jsSchema
    ? {
        experimental: { adapter: true },
        engine: "js" as const,
        adapter: async () =>
          new CloudSchemaAdapter({
            connectionString: process.env.DATABASE_URL!,
            max: 1,
          }),
      }
    : {}),
});
