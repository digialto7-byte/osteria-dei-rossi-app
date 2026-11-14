// SP0 spike: a staff user for the T4 seed, made with the admin client: an auth user plus an `app_user` row of the REQUESTED role. A waiter signs
// in for the order entry; a chef for the kitchen mark (only owner, admin or chef may call kitchen_mark_line).
export interface StaffAdmin {
  auth: {
    admin: {
      createUser(attributes: {
        email: string;
        password: string;
        email_confirm: boolean;
      }): PromiseLike<{
        data: { user: { id: string } | null };
        error: unknown;
      }>;
    };
  };
  from(table: "app_user"): {
    insert(row: {
      tenant_id: string;
      auth_id: string;
      role: "waiter" | "chef";
      display_name: string;
    }): PromiseLike<{ error: unknown }>;
  };
}

export async function createStaffUser(
  admin: StaffAdmin,
  tenantId: string,
  role: "waiter" | "chef",
  ids: { newId(): string; newPassword(): string },
): Promise<{ email: string; password: string }> {
  const email = `sp0-${role}-${ids
    .newId()
    .replace(/[^0-9a-f]/gi, "")
    .slice(0, 8)
    .toLowerCase()}@example.test`;
  const password = ids.newPassword();
  const made = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (made.error || made.data.user === null) throw new Error(`creating the ${role} failed`);
  const member = await admin
    .from("app_user")
    .insert({ tenant_id: tenantId, auth_id: made.data.user.id, role, display_name: `SP0 ${role}` });
  if (member.error) throw new Error(`adding the ${role} failed`);
  return { email, password };
}
