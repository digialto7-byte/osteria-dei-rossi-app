import { z } from "zod";
import { venueSettingsSchema } from "@/lib/venue/settings";

/**
 * The reply of GET /api/me, strict: an unknown key (a VAT list, a cost) is refused, so a waiter's offline-cached
 * reply can never carry one (SP1 plan §3.4, §3.9). Missing or malformed `settings` is a refusal, not a default.
 */
export const meOutput = z.strictObject({
  user: z.strictObject({
    id: z.uuid(),
    displayName: z.string(),
    role: z.enum(["owner", "admin", "chef", "waiter"]),
  }),
  tenant: z.strictObject({ id: z.uuid(), name: z.string(), isDemo: z.boolean() }),
  settings: venueSettingsSchema,
});
export type MeReply = z.infer<typeof meOutput>;
