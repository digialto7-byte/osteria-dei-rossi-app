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

// The extraction and cron variables are read through src/lib/env only (plan M3 step 2).
const ENV_ONLY_VARIABLES = [
  "ANTHROPIC_API_KEY",
  "EXTRACTION_MODEL_ID",
  "CRON_SECRET",
  "PIN_PEPPER",
];
const ENV_FILES = ["src/lib/env/**"];
// Allowed secret-key files that live under src/; they still may not read the extraction variables.
const SECRET_KEY_ALLOWED_SRC_FILES = SECRET_KEY_ALLOWED_FILES.filter((glob) =>
  glob.startsWith("src/"),
);

const readOf = (name, message) => [
  { selector: `MemberExpression[property.name='${name}']`, message },
  { selector: `MemberExpression[property.value='${name}']`, message },
  { selector: `Literal[value='${name}']`, message },
  { selector: `Property[key.name='${name}']`, message },
];

const secretKeyRules = readOf("SUPABASE_SECRET_KEY", secretKeyRead.message);
const envOnlyRules = ENV_ONLY_VARIABLES.flatMap((name) =>
  readOf(name, `Read ${name} only through src/lib/env.`),
);
const adminImportRules = [
  {
    selector: "ImportExpression[source.value=/(supabase\\/|^\\.\\.?\\/)admin(\\.[cm]?[jt]s)?$/]",
    message: adminClientImport.message,
  },
];

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
    ignores: [...SECRET_KEY_ALLOWED_FILES, ...ENV_FILES],
    rules: {
      "no-restricted-syntax": ["error", ...secretKeyRules, ...adminImportRules, ...envOnlyRules],
    },
  },
  {
    // Allowed to hold the secret key, but not to read the extraction variables.
    files: SECRET_KEY_ALLOWED_SRC_FILES,
    rules: { "no-restricted-syntax": ["error", ...envOnlyRules] },
  },
  {
    // The one place that reads the extraction variables; it may not touch the secret key.
    files: ENV_FILES,
    rules: { "no-restricted-syntax": ["error", ...secretKeyRules, ...adminImportRules] },
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
