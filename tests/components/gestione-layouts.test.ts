// @vitest-environment jsdom
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import AnagraficheLayout from "@/app/(owner)/anagrafiche/layout";
import CostiLayout from "@/app/(owner)/costi/layout";
import DispositiviLayout from "@/app/(owner)/dispositivi/layout";
import DoppiaVerificaLayout from "@/app/(owner)/doppia-verifica/layout";
import ImpostazioniLayout from "@/app/(owner)/impostazioni/layout";
import MenuLayout from "@/app/(owner)/menu/layout";
import PasswordLayout from "@/app/(owner)/password/layout";
import PersonaleLayout from "@/app/(owner)/personale/layout";
import RegistroLayout from "@/app/(owner)/registro/layout";
import RicetteLayout from "@/app/(owner)/ricette/layout";
import SicurezzaLayout from "@/app/(owner)/sicurezza/layout";

// P2h-2 (ADR-045): the eleven roots of step 7 wear the Costì look through their group layout; the child stays a sibling of the marker.
describe.each([
  ["ricette", RicetteLayout],
  ["costi", CostiLayout],
  ["anagrafiche", AnagraficheLayout],
  ["personale", PersonaleLayout],
  ["registro", RegistroLayout],
  ["impostazioni", ImpostazioniLayout],
  ["menu", MenuLayout],
  ["dispositivi", DispositiviLayout],
  ["doppia-verifica", DoppiaVerificaLayout],
  ["password", PasswordLayout],
  ["sicurezza", SicurezzaLayout],
])("the %s layout", (_name, Layout) => {
  it("renders the Costì marker once, before its children", () => {
    const html = renderToStaticMarkup(
      createElement(Layout, null, createElement("p", null, "pagina")),
    );
    expect(html).toBe('<span data-brand="costi" hidden=""></span><p>pagina</p>');
  });
});
