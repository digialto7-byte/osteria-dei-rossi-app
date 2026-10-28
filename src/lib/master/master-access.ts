// Role gates for the master-data screens (suppliers, ingredients, locations, import). Pure; they only
// hide what the API would refuse anyway.

/**
 * Master data is readable by owner, admin and chef (the chef needs the allergens). Mirrors
 * `GET /api/suppliers`, `/api/ingredients` and `/api/locations`.
 */
export const canReadMasterData = (role: string): boolean =>
  role === "owner" || role === "admin" || role === "chef";

/**
 * Master data is written by owner and admin only. Mirrors the `POST`s of `/api/suppliers`,
 * `/api/ingredients` and `/api/locations`, and `/api/admin/import/*`.
 */
export const canEditMasterData = (role: string): boolean => role === "owner" || role === "admin";
