import type { it } from "./it";

/** Italian is the source catalogue; every other locale must provide the same keys. */
export type MessageKey = keyof typeof it;
