import type { SupabaseClient } from "@supabase/supabase-js";
import { mapReservationsDbError } from "./errors";
import { parseReply, reservationSettingsOutput, setReservationSettingsOutput } from "./output";
import type { ReservationSettingsBody } from "./schemas";

/** GET /api/settings/reservations: the settings (the defaults when the owner never saved), with the readiness of the public page and the services in force. */
export async function readReservationSettings(supabase: SupabaseClient) {
  const { data, error } = await supabase.rpc("reservation_settings");
  if (error) throw mapReservationsDbError(error);
  return parseReply(reservationSettingsOutput, data);
}

/** PATCH /api/settings/reservations: the keys sent change, the rest stay. An identical save changes nothing (`changed: false`). */
export async function saveReservationSettings(
  supabase: SupabaseClient,
  body: ReservationSettingsBody,
) {
  const { data, error } = await supabase.rpc("set_reservation_settings", { p_body: body });
  if (error) throw mapReservationsDbError(error);
  return parseReply(setReservationSettingsOutput, data);
}
