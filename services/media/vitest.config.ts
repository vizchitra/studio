import path from "node:path";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig(async () => {
  const migrationsPath = path.join(__dirname, "..", "..", "migrations");
  const migrations = await readD1Migrations(migrationsPath);

  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: "./wrangler.toml" },
        // The AI binding has no local simulation — it always needs a real,
        // authenticated remote proxy session, which CI doesn't have (and
        // shouldn't need just to run unit tests). No pipeline test calls
        // env.AI for real; they all inject a mock via ctx.ai directly (see
        // pipeline.test.ts's face_clustering describe block), so disabling
        // remote bindings here is safe — nothing needs the real AI binding
        // to exist.
        remoteBindings: false,
        miniflare: {
          bindings: { TEST_MIGRATIONS: migrations },
        },
      }),
    ],
    test: {
      setupFiles: ["./test/apply-migrations.ts"],
      restoreMocks: true,
    },
  };
});
