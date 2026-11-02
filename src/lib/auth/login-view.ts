// Presentation helpers for /login (M25a). Pure: they decide nothing about who may sign in (Supabase Auth and the
// API do); they only read the page's query values and shape what is typed.

export type LoginNotice = "link" | "session";

/** The notice for a `?errore=` value, or null for any other value. */
export function loginNotice(errore: string | undefined): LoginNotice | null {
  if (errore === "link") return "link";
  if (errore === "sessione") return "session";
  return null;
}

/** True when no e-mail address was typed, so "Inviami il link" has nobody to write to. */
export function needsEmail(email: string): boolean {
  return email.trim() === "";
}

export function passwordFieldType(shown: boolean): "text" | "password" {
  return shown ? "text" : "password";
}

export function toggleLabelKey(shown: boolean): "login.hide" | "login.show" {
  return shown ? "login.hide" : "login.show";
}

/** Keeps the digits typed or pasted into the code field, at most six. */
export function codeDigits(raw: string): string {
  return raw.replace(/\D/g, "").slice(0, 6);
}
