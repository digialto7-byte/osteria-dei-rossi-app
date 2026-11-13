// Who sees "Verifica in due passaggi" (/doppia-verifica) and the second-factor accounts (P2-1). Only the owner and the admin manage their own
// factors; the waiter and the chef never do (they sign in with a PIN or have no second factor). Hiding a link is not authorisation: the API and
// Postgres enforce the same roles.
export const canManageMfa = (role: string): boolean => role === "owner" || role === "admin";
