/** Who is shown the "Scarica CSV" links and "Pacchetto mensile": the owner and the admin. Display only, not authorisation: the route and the SQL decide (M24 plan §3.6). */
export function canExport(role: string | null | undefined): boolean {
  return role === "owner" || role === "admin";
}
