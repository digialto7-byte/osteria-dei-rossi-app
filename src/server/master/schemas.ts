import { z } from "zod";

export const idParams = z.object({ id: z.uuid() });

/** A PATCH body must change something. */
export const nonEmpty = (value: object) => Object.keys(value).length > 0;
export const NON_EMPTY_MESSAGE = "Indica almeno un campo da modificare.";

export const trimmedText = (max: number) => z.string().trim().min(1).max(max);
