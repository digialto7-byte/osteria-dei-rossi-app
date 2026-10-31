import { remainingLabel } from "@/lib/kitchen/kitchen-done";

/** "Da fare: 7" in large type, or "Tutto fatto" at 0. The number is the server's: this only words it. */
export function RemainingCount({ remaining }: { remaining: number }) {
  return (
    <p data-remaining={remaining} className="num font-display text-3xl leading-tight font-bold">
      {remainingLabel(remaining)}
    </p>
  );
}
