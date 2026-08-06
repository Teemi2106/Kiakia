import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    setupFiles: ["./src/test/setup.ts"],
    // Placeholder, correctly-shaped values only — mirrors ci.yml's env
    // block. Lets every module's import-time env.*.ts zod parse succeed
    // without a live Supabase/Monnify project.
    env: {
      NEXT_PUBLIC_SUPABASE_URL: "https://placeholder.supabase.co",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "placeholder-publishable-key",
      NEXT_PUBLIC_SITE_URL: "http://localhost:3000",
      SUPABASE_SERVICE_ROLE_KEY: "placeholder-service-role-key",
      MONNIFY_API_KEY: "placeholder-monnify-api-key",
      MONNIFY_API_SECRET: "placeholder-monnify-api-secret",
      MONNIFY_CONTRACT_CODE: "placeholder-contract-code",
      MONNIFY_BASE_URL: "https://sandbox.monnify.com",
    },
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/test/**"],
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "server-only": path.resolve(__dirname, "./src/test/server-only-stub.ts"),
    },
  },
});
