// Who sees what of the push list (M23 plan §3.5, §3.6). The database enforces every rule too: hiding a button is not authorisation.

/** Who may open the push screen and read the list: the owner, the admin and the chef. */
export function canReadPushList(role: string | undefined): boolean {
  return role === "owner" || role === "admin" || role === "chef";
}

/** Who may push a plate (Q158): the owner and the admin. The chef sees the list and asks. */
export function canPush(role: string | undefined): boolean {
  return role === "owner" || role === "admin";
}
