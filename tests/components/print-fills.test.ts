// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DifferenceCard } from "@/app/(owner)/chiusura/difference-card";
import { SegmentedControl } from "@/components/segmented-control";
import {
  Badge,
  type BadgeTone,
  Button,
  Card,
  ErrorAlert,
  InfoNotice,
  SuccessNote,
  primaryLinkClass,
  warningNoteClass,
} from "@/components/ui";
import { REPORT } from "../helpers/bill-data";
import { PRINT_FILLS } from "./print-fills-selectors";

// The print-fill rule in globals.css (costi-design-system §10.5) targets classes and attributes the components already render. This is the
// link between the two: if a component stops rendering its fill class, or a fill is made another way, this list fails. A new filled
// component goes here.
afterEach(cleanup);
const fill = PRINT_FILLS.join(",");

describe("filled components are matched by the print-fill rule", () => {
  it.each<BadgeTone>(["neutral", "info", "warning", "success", "danger", "highlight"])(
    "Badge %s",
    (tone) => {
      render(createElement(Badge, { tone }, "Parola"));
      expect(screen.getByText("Parola").matches(fill)).toBe(true);
    },
  );

  it("the primary Button", () => {
    render(createElement(Button, null, "Salva"));
    expect(screen.getByRole("button", { name: "Salva" }).matches(fill)).toBe(true);
  });

  it("a link with primaryLinkClass", () => {
    render(createElement("a", { href: "/x", className: primaryLinkClass }, "Avanti"));
    expect(screen.getByRole("link", { name: "Avanti" }).matches(fill)).toBe(true);
  });

  it("the selected SegmentedControl tab, but not an unselected one", () => {
    render(
      createElement(SegmentedControl, {
        label: "Periodo",
        segments: [
          { key: "a", label: "Uno" },
          { key: "b", label: "Due" },
        ],
        selected: "a",
        onSelect: () => {},
      }),
    );
    expect(screen.getByRole("tab", { name: "Uno" }).matches(fill)).toBe(true);
    expect(screen.getByRole("tab", { name: "Due" }).matches(fill)).toBe(false);
  });

  it("the Coral edge of a Card", () => {
    const { container } = render(createElement(Card, { edge: true }, "Contenuto"));
    const edge = container.querySelector("span[aria-hidden]") as HTMLElement;
    expect(edge.matches(fill)).toBe(true);
  });

  it("InfoNotice, SuccessNote, ErrorAlert and an element with warningNoteClass", () => {
    render(
      createElement(
        "div",
        null,
        createElement(InfoNotice, null, "Info"),
        createElement(SuccessNote, null, "Fatto"),
        createElement(ErrorAlert, { message: "Errore" }),
        createElement("p", { className: warningNoteClass }, "Attenzione"),
      ),
    );
    for (const word of ["Info", "Fatto", "Errore", "Attenzione"]) {
      expect(screen.getByText(word).matches(fill), word).toBe(true);
    }
  });
});

describe("things that are not fills are not matched", () => {
  it("the difference card's data-tone paragraph has no fill", () => {
    const { container } = render(
      createElement(DifferenceCard, { register: REPORT.register, difference: REPORT.difference }),
    );
    const tone = container.querySelector("p[data-tone]") as HTMLElement;
    expect(tone).not.toBeNull();
    expect(tone.matches(fill)).toBe(false);
  });
});
