import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DeviceRow } from "@/app/(owner)/dispositivi/device-row";
import type { DeviceView } from "@/server/staff-auth/types";

const DEVICE: DeviceView = {
  id: "55555555-5555-4555-8555-555555555555",
  label: "Telefono sala (demo)",
  status: "attivo",
  enrolledAt: "2026-10-24T10:00:00Z",
  lastLoginAt: "2026-10-24T17:02:00Z",
  lockedAt: null,
};
const noop = () => undefined;
const render = (over: Partial<DeviceView> = {}, confirming = false) =>
  renderToStaticMarkup(
    createElement(
      "ul",
      null,
      createElement(DeviceRow, {
        device: { ...DEVICE, ...over },
        confirming,
        busy: false,
        onUnlock: noop,
        onAskRevoke: noop,
        onConfirmRevoke: noop,
        onCancelRevoke: noop,
      }),
    ),
  );

describe("DeviceRow", () => {
  it("label, status word and the meta line in .num", () => {
    const html = render();
    expect(html).toContain("Telefono sala (demo)");
    expect(html).toContain("Attivo");
    expect(html).toMatch(
      /<p class="num[^"]*"[^>]*>Abilitato il 24\/10\/2026 · ultimo accesso 24\/10\/2026 19:02<\/p>/,
    );
  });
  it("'Sblocca' only when locked; 'Revoca' unless revoked", () => {
    expect(render()).not.toContain(">Sblocca<");
    expect(render()).toContain(">Revoca<");
    const locked = render({ status: "bloccato", lockedAt: "2026-10-24T17:10:00Z" });
    expect(locked).toContain(">Sblocca<");
    expect(locked).toContain(">Revoca<");
    const revoked = render({ status: "revocato" });
    expect(revoked).not.toContain(">Sblocca<");
    expect(revoked).not.toContain(">Revoca<");
    expect(revoked).toContain("Revocato");
  });
  it("'Revoca' opens a confirm step that names the device", () => {
    expect(render()).not.toContain("Chi lo usa verrà disconnesso");
    const html = render({}, true);
    expect(html).toContain("Revocare Telefono sala (demo)? Chi lo usa verrà disconnesso.");
    expect(html).toContain('role="alertdialog"');
    expect(html).toContain(">Annulla<");
  });
  it("action buttons are 44 px and described by the device name", () => {
    const html = render({ status: "bloccato" });
    for (const button of html.match(/<button[^>]*>/g) ?? []) {
      expect(button).toContain("min-h-tap");
      expect(button).toMatch(/aria-describedby="device-[^"]*-name"/);
    }
  });
  it("escapes the label", () => {
    expect(render({ label: "<img src=x>" })).not.toContain("<img");
  });
});
