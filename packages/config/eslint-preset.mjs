import tseslint from "typescript-eslint";

/**
 * Base ESLint flat config shared by every package/app in the monorepo.
 * Apps that also need Next.js-specific rules compose this with
 * `eslint-config-next` locally (see apps/web/eslint.config.mjs).
 */
export const baseConfig = tseslint.config(
  {
    ignores: [
      "**/.next/**",
      "**/dist/**",
      "**/build/**",
      "**/coverage/**",
      "**/node_modules/**",
    ],
  },
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "inline-type-imports" },
      ],
      "no-console": ["warn", { allow: ["warn", "error"] }],
    },
  },
);

export default baseConfig;
