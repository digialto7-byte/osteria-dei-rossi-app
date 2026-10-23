import { describe, expect, it } from "vitest";
import {
  codeExpiryLine,
  deviceActions,
  deviceMeta,
  deviceStatusView,
  pendingCodeLine,
  revokeConfirmText,
} from "@/lib/staff-auth/device-view";

describe("deviceStatusView", () => {
  it("says a word for each status", () => {
    expect(deviceStatusView("attivo")).toEqual({ tone: "success", label: "Attivo" });
    expect(deviceStatusView("bloccato")).toEqual({ tone: "warning", label: "Bloccato" });
    expect(deviceStatusView("revocato")).toEqual({ tone: "neutral", label: "Revocato" });
    expect(deviceStatusView("bloccato", "en").label).toBe("Locked");
  });
});

describe("deviceMeta", () => {
  it("'Abilitato il 24/10/2026 · ultimo accesso 24/10/2026 19:02' in Europe/Rome", () => {
    expect(
      deviceMeta({ enrolledAt: "2026-10-24T10:00:00Z", lastLoginAt: "2026-10-24T17:02:00Z" }),
    ).toBe("Abilitato il 24/10/2026 · ultimo accesso 24/10/2026 19:02");
  });
  it("a device never used says so", () => {
    expect(deviceMeta({ enrolledAt: "2026-10-24T10:00:00Z", lastLoginAt: null })).toBe(
      "Abilitato il 24/10/2026 · mai usato",
    );
  });
  it("the Rome date can differ from the UTC date", () => {
    expect(deviceMeta({ enrolledAt: "2026-10-24T22:30:00Z", lastLoginAt: null })).toContain(
      "25/10/2026",
    );
  });
  it("english second", () => {
    expect(deviceMeta({ enrolledAt: "2026-10-24T10:00:00Z", lastLoginAt: null }, "en")).toBe(
      "Enabled on 24/10/2026 · never used",
    );
  });
});

describe("deviceActions", () => {
  it("unlock only when locked; revoke unless revoked", () => {
    expect(deviceActions("attivo")).toEqual({ unlock: false, revoke: true });
    expect(deviceActions("bloccato")).toEqual({ unlock: true, revoke: true });
    expect(deviceActions("revocato")).toEqual({ unlock: false, revoke: false });
  });
});

describe("code texts", () => {
  it("'Scade alle 19:17.' for a code expiring at 17:17Z in summer time", () => {
    expect(codeExpiryLine("2026-10-24T17:17:00Z")).toBe(
      "Scade alle 19:17. Inseriscilo nel dispositivo da abilitare.",
    );
  });
  it("a pending code line names the label and the time, never the code", () => {
    expect(
      pendingCodeLine({ label: "Tablet cucina (demo)", expiresAt: "2026-10-24T17:17:00Z" }),
    ).toBe("Tablet cucina (demo) · scade alle 19:17");
  });
  it("the revoke question names the device", () => {
    expect(revokeConfirmText("Telefono sala (demo)")).toBe(
      "Revocare Telefono sala (demo)? Chi lo usa verrà disconnesso.",
    );
  });
});
