import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier/flat";

// The Supabase secret key bypasses RLS. Only scheduled jobs and admin scripts may use it
// (plan §3.11.1, M0 acceptance test 11); everything user-facing goes through RLS.
export const SECRET_KEY_ALLOWED_FILES = [
  "src/lib/supabase/admin.ts",
  "src/app/api/cron/**",
  "src/server/cron/**",
  "scripts/**",
  "tests/lib/supabase/admin.test.ts",
  "tests/scripts/**",
  // Real-stack fixtures (tenants, users) are created with the local stack's own secret key.
  "tests/integration/**",
];

const adminClientImport = {
  regex:
    "(^@/lib/supabase/admin(\\.[cm]?[jt]s)?$)|(/supabase/admin(\\.[cm]?[jt]s)?$)|(^\\.\\.?/admin(\\.[cm]?[jt]s)?$)",
  message:
    "The secret-key admin client bypasses RLS: import it only from src/app/api/cron/**, src/server/cron/** or scripts/.",
};

const secretKeyRead = {
  message: "Read SUPABASE_SECRET_KEY only in src/lib/supabase/admin.ts.",
};

const config = [
  {
    ignores: [
      ".next/**",
      "coverage/**",
      "playwright-report/**",
      "test-results/**",
      "next-env.d.ts",
    ],
  },
  ...nextCoreWebVitals,
  ...nextTypescript,
  prettier,
  {
    rules: {
      "no-restricted-imports": ["error", { patterns: [adminClientImport] }],
      "no-console": ["error", { allow: ["warn", "error"] }],
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: SECRET_KEY_ALLOWED_FILES,
    rules: {
      "no-restricted-syntax": [
        "error",
        { selector: "MemberExpression[property.name='SUPABASE_SECRET_KEY']", ...secretKeyRead },
        { selector: "Literal[value='SUPABASE_SECRET_KEY']", ...secretKeyRead },
        { selector: "Property[key.name='SUPABASE_SECRET_KEY']", ...secretKeyRead },
        {
          selector:
            "ImportExpression[source.value=/(supabase\\/|^\\.\\.?\\/)admin(\\.[cm]?[jt]s)?$/]",
          message: adminClientImport.message,
        },
      ],
    },
  },
  {
    files: SECRET_KEY_ALLOWED_FILES,
    rules: { "no-restricted-imports": "off" },
  },
  {
    files: ["scripts/**", "e2e/**"],
    rules: { "no-console": "off" },
  },
];

export default config;
