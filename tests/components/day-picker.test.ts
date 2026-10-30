// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DayPicker } from "@/app/(owner)/chiusura/day-picker";

afterEach(cleanup);

describe("DayPicker", () => {
  it("has a labelled date field showing the business date", () => {
    render(createElement(DayPicker, { date: "2026-11-04", onChange: () => undefined }));
    const field = screen.getByLabelText("Giorno") as HTMLInputElement;
    expect(field.type).toBe("date");
    expect(field.value).toBe("2026-11-04");
    expect(field.className).toContain("min-h-tap");
  });

  it("'Giorno precedente' asks for the day before (a calendar date: no zone moves it)", () => {
    const onChange = vi.fn();
    render(createElement(DayPicker, { date: "2026-11-01", onChange }));
    fireEvent.click(screen.getByRole("button", { name: "Giorno precedente" }));
    expect(onChange).toHaveBeenCalledWith("2026-10-31");
  });

  it("picking a date asks for it, and an emptied field asks for nothing", () => {
    const onChange = vi.fn();
    render(createElement(DayPicker, { date: "2026-11-04", onChange }));
    fireEvent.change(screen.getByLabelText("Giorno"), { target: { value: "2026-10-30" } });
    fireEvent.change(screen.getByLabelText("Giorno"), { target: { value: "" } });
    expect(onChange.mock.calls).toEqual([["2026-10-30"]]);
  });
});
