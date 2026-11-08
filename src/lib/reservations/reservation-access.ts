/** Owner, admin and waiter read the day of reservations; the chef never does. Mirrors the API's role list (GET /api/reservations). */
export const canUseReservations = (role: string): boolean =>
  role === "owner" || role === "admin" || role === "waiter";
