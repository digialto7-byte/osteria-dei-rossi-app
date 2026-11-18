import { reportError } from "@/lib/observability/report";
import {
  FIRST_PAINT_VENUE_SETTINGS,
  venueSettingsSchema,
  type VenueSettings,
} from "@/lib/venue/settings";

// The browser's copy of the tenant's venue settings. Not React state: the formatters read it. On the server it
// is never filled, so concurrent requests of different tenants cannot share it; server code passes the zone.
const STORAGE_KEY = "venue-settings";

const inBrowser = typeof window !== "undefined";
let current: VenueSettings | null = inBrowser ? readStored() : null;

function storage(): Storage | null {
  return inBrowser ? window.localStorage : null;
}

// A value that is missing is simply absent. One that is there but unreadable or invalid is treated as absent
// AND reported (Rule B), so the store stays unfilled until /api/me applies the real settings.
function readStored(): VenueSettings | null {
  try {
    const raw = storage()?.getItem(STORAGE_KEY) ?? null;
    if (raw === null) return null;
    const parsed = venueSettingsSchema.safeParse(JSON.parse(raw));
    if (parsed.success) return parsed.data;
    reportError(new Error("venue-settings in localStorage failed validation"));
    return null;
  } catch (error) {
    reportError(error);
    return null;
  }
}

/** The settings to format with: the applied ones, else the first-paint default. */
export function currentVenueSettings(): VenueSettings {
  return current ?? FIRST_PAINT_VENUE_SETTINGS;
}

/** True once real settings are in the store (from /api/me, or a valid copy from this device's last visit). */
export function venueSettingsApplied(): boolean {
  return current !== null;
}

export function applyVenueSettings(settings: VenueSettings): void {
  if (!inBrowser) return;
  current = settings;
  try {
    storage()?.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch (error) {
    // The settings stay in memory for this visit; the refusal is reported, not hidden.
    reportError(error);
  }
}

export function resetVenueSettings(): void {
  current = null;
  try {
    storage()?.removeItem(STORAGE_KEY);
  } catch (error) {
    reportError(error);
  }
}
