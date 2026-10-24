/** Largest body of a PATCH /api/rules/* call; a patch is a few keys, so 4 KiB is generous. */
export const MAX_RULES_BODY_BYTES = 4096;
/** Largest stock level, in base units (kg, l or pz). Mirrors app.rules_numeric in the settings procedures. */
export const RULES_LEVEL_MAX = 100_000;
/** Decimals a stock level may have. Mirrors app.rules_numeric. */
export const RULES_LEVEL_DECIMALS = 4;
/** Supplier lead time in days. Mirrors public.set_supplier_delivery. */
export const RULES_LEAD_TIME_MAX = 365;
/** Minimum and target portions of a batch recipe. Mirrors public.set_recipe_rules. */
export const RULES_PORTIONS_MAX = 10_000;
/** Preparation time in minutes (one day). Mirrors public.set_recipe_rules. */
export const RULES_PREP_TIME_MAX = 1440;
