import { HeaderBand } from "@/components/header-band";
import { t } from "@/lib/i18n";

// SP3 step 21 (plan section 3.8.3): the console's header band is the constant «Costì · Console» in the product's own tokens. It takes no arguments,
// so nothing the page knows can reach it; the band stays the same when the account is inside another place.
// Text "Console" re-uses the proposal C1 wording of docs/ux/costi-console.md section 3.
const CONSOLE_LABEL = "Console";

export function ConsoleBand() {
  return (
    <HeaderBand
      brand={
        <span className="-my-1.5 inline-flex min-h-tap items-center gap-2.5 font-display text-[1.3125rem] leading-none font-semibold tracking-[0.1em] text-band-ink uppercase">
          {`${t("app.name")} · ${CONSOLE_LABEL}`}
        </span>
      }
    />
  );
}
