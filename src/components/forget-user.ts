import { resetMe } from "@/components/use-me";
import { postClearUserData } from "@/pwa/register";
import { clearSyncUser } from "@/pwa/use-outbox";

/**
 * Ends one person's use of the phone (logout, PIN login, the demo purge): the cached user is forgotten, the queue stops treating them as the signed-in person, and the service worker is told to
 * delete its read cache (M20 plan §3.6.3). The outbox stays, so operations held for that person survive.
 */
export function forgetUser(
  reset: () => void = resetMe,
  post: () => boolean = postClearUserData,
  clearQueueUser: () => void = clearSyncUser,
): void {
  post();
  reset();
  clearQueueUser();
}
