import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { preflight, renderPreflightNotice } from "./preflight";

// Run by the workflow before the paid calls. Exit 0: ready. Exit 3: skip (prints the notice).
const SKIP_EXIT_CODE = 3;
const folder = fileURLToPath(new URL("./invoices/", import.meta.url));

let files: string[] = [];
try {
  files = readdirSync(folder);
} catch {
  // No folder means no invoices: reported below as "found 0".
}

const result = preflight({ files, env: process.env });
if (result.ready) {
  console.warn("Contract preflight: ready.");
} else {
  console.warn(renderPreflightNotice(result));
  process.exitCode = SKIP_EXIT_CODE;
}
