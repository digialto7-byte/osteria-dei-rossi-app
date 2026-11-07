import { renderSmokeNotice, smokePreflight } from "./smoke";

// Run by the workflow before the paid call. Exit 0: ready. Exit 3: skip (prints the notice).
const SKIP_EXIT_CODE = 3;

const result = smokePreflight(process.env);
if (result.ready) {
  console.warn("Smoke preflight: ready.");
} else {
  console.warn(renderSmokeNotice(result));
  process.exitCode = SKIP_EXIT_CODE;
}
