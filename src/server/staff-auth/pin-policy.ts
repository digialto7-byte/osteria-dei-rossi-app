import { PIN_LENGTH } from "./constants";

export type PinCheck = "ok" | "format" | "trivial";

const FORMAT = new RegExp(`^[0-9]{${PIN_LENGTH}}$`);

/**
 * Checks a PIN before it is used to create or reset an account.
 *   format  - not exactly four ASCII digits (a 400 at the route; the Zod body checks it first);
 *   trivial - all digits equal (0000), an ascending (1234) or descending (9876) run, or a repeated pair
 *             (1212): a 422 `pin_trivial`;
 *   ok      - anything else.
 */
export function checkPin(pin: string): PinCheck {
  if (!FORMAT.test(pin)) return "format";
  const d = [...pin].map(Number) as [number, number, number, number];
  const step = d[1] - d[0];
  const run = (step === 1 || step === -1) && d[2] - d[1] === step && d[3] - d[2] === step;
  const repeated = d[0] === d[2] && d[1] === d[3];
  return run || repeated ? "trivial" : "ok";
}
