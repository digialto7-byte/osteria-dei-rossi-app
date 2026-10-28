// Role gate for the invoice screens. Pure; it only hides what the API would refuse anyway.

/** Invoices carry prices and payables: owner and admin only. Mirrors `GET /api/invoices` (src/app/api/invoices/route.ts). */
export const canReadInvoices = (role: string): boolean => role === "owner" || role === "admin";
