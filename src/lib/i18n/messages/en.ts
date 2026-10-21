import type { MessageKey } from "./keys";

export const en: Record<MessageKey, string> = {
  "app.name": "Osteria Digitalization",
  "login.title": "Sign in",
  "login.intro": "We will email you a sign-in link.",
  "login.email": "Email",
  "login.submit": "Send me the link",
  "login.linkError": "The link is invalid or has expired. Request a new one.",
  "login.sent": "If the address is registered, you will receive an email with the sign-in link.",
  "login.error": "Something went wrong. Please try again shortly.",
  "home.greeting": "Hello, {name}",
  "home.role": "Role: {role}",
  "home.loading": "Loading…",
  "home.signedOut": "You are not signed in.",
  "home.noAccess": "Your account is not enabled for any venue.",
  "home.logout": "Sign out",
  "role.owner": "Owner",
  "role.admin": "Administrator",
  "role.chef": "Kitchen",
  "role.waiter": "Floor",
};
