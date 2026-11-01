import { z } from "zod";

/** `[file]` of `/api/exports/[file]`: a lower-case slug with the `.csv` extension. Which slugs exist is the registry's business (404). */
export const exportParams = z.object({ file: z.string().regex(/^[a-z-]+\.csv$/) });
