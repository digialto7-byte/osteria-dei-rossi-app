import type { ReactNode } from "react";
import { HeaderBand } from "@/components/header-band";
import { t } from "@/lib/i18n";

// SP3 step 21 (plan section 3.8.3): the console's header band is the constant «Costì · Console» in the product's own tokens. The label takes
// nothing from the page, so no name can reach it; the band stays the same when the account is inside another place.
// Text "Console" re-uses the proposal C1 wording of docs/ux/costi-console.md section 3.
const CONSOLE_LABEL = "Console";

/** A node, or an explicit null for "nothing": undefined and booleans are not empty values here. */
export type ConsoleAccount = Exclude<ReactNode, undefined | boolean> | null;

/**
 * `account` is the signed-in person's own control (the console's «Esci»): required, so a caller passes a node or an explicit null. A node goes on the right of
 * the band after the label; null adds no element at all.
 */
export function ConsoleBand({ account }: { account: ConsoleAccount }) {
  return (
    <HeaderBand
      account={account === null ? null : <div className="ml-auto">{account}</div>}
      brand={
        <span className="-my-1.5 inline-flex min-h-tap items-center gap-2.5 font-display text-[1.3125rem] leading-none font-semibold tracking-[0.1em] text-band-ink uppercase">
          {`${t("app.name")} · ${CONSOLE_LABEL}`}
        </span>
      }
    />
  );
}
