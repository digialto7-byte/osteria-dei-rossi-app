// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SyncNotices } from "@/components/sync/sync-notices";
import type { Notice } from "@/lib/sync/notices";
import { opId, SYNC_IDS } from "../helpers/sync-data";

afterEach(cleanup);
const notice = (n: number, text: string, kind: Notice["kind"] = "conflict"): Notice => ({
  id: opId(n),
  opIds: [opId(n)],
  kind,
  sessionId: SYNC_IDS.s1,
  text,
});

describe("SyncNotices", () => {
  it("one alert per notice, found by op id, each with a 44 px 'Ho capito'", () => {
    const { container } = render(
      createElement(SyncNotices, {
        notices: [
          notice(1, "«Spezzatino con polenta (demo)» era già in cucina."),
          notice(2, "Non inviato: «Acqua (demo)».", "dropped"),
        ],
        onDismiss: () => undefined,
      }),
    );
    const first = container.querySelector(`[data-op-id="${opId(1)}"]`) as HTMLElement;
    const second = container.querySelector(`[data-op-id="${opId(2)}"]`) as HTMLElement;
    expect(first.getAttribute("role")).toBe("alert");
    expect(first.textContent).toContain("era già in cucina");
    expect(second.textContent).toContain("Non inviato");
    const button = within(first).getByRole("button", { name: "Ho capito" });
    expect(button.className).toContain("min-h-tap");
    expect(screen.getAllByRole("alert")).toHaveLength(2);
  });

  it("'Ho capito' dismisses that notice only", () => {
    const onDismiss = vi.fn();
    const notices = [notice(1, "uno"), notice(2, "due")];
    const { container } = render(createElement(SyncNotices, { notices, onDismiss }));
    fireEvent.click(
      within(container.querySelector(`[data-op-id="${opId(2)}"]`) as HTMLElement).getByRole(
        "button",
      ),
    );
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onDismiss).toHaveBeenCalledWith(notices[1]);
  });

  it("a script in a note or a dish name renders as text, never as markup", () => {
    const { container } = render(
      createElement(SyncNotices, {
        notices: [notice(1, "«<script>alert(1)</script>» era già in cucina.")],
        onDismiss: () => undefined,
      }),
    );
    expect(container.querySelector("script")).toBeNull();
    expect(container.textContent).toContain("<script>alert(1)</script>");
  });

  it("renders nothing for no notices", () => {
    const { container } = render(
      createElement(SyncNotices, { notices: [], onDismiss: () => undefined }),
    );
    expect(container.innerHTML).toBe("");
  });

  it("no cost, margin or euro sign", () => {
    const { container } = render(
      createElement(SyncNotices, { notices: [notice(1, "x")], onDismiss: () => undefined }),
    );
    expect(container.textContent).not.toMatch(/€|Costo|Margine|Food cost/);
  });
});
