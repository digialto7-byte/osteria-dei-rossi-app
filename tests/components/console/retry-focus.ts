import { act, fireEvent, screen } from "@testing-library/react";
import { expect } from "vitest";

type HoldableApi = {
  mockImplementationOnce: (fn: () => Promise<never>) => unknown;
  mock: { calls: unknown[] };
};

/**
 * Presses the shown «Riprova» with its focus set and the next read held open. `answer` finishes that read. The retry must keep the same
 * button mounted, focused and aria-disabled (never `disabled`, which drops focus to <body>) while the read is in flight.
 */
export function pressRetryHolding(apiJson: HoldableApi) {
  const button = screen.getByRole("button", { name: "Riprova" }) as HTMLButtonElement;
  button.focus();
  let release!: (reply: unknown) => void;
  apiJson.mockImplementationOnce(
    () =>
      new Promise<never>((resolve) => {
        release = resolve as (reply: unknown) => void;
      }),
  );
  fireEvent.click(button);
  expect(button.isConnected).toBe(true);
  expect(button.getAttribute("aria-disabled")).toBe("true");
  expect(button.hasAttribute("disabled")).toBe(false);
  expect(document.activeElement).toBe(button);
  // a second click (or Enter) during the retry starts no other read
  const reads = apiJson.mock.calls.length;
  fireEvent.click(button);
  expect(apiJson.mock.calls.length).toBe(reads);
  return { button, answer: (reply: unknown) => act(async () => release(reply)) };
}

/** After a retry that failed again: the very same button, enabled again, still focused. */
export function expectSameFocusedButton(button: HTMLButtonElement) {
  expect(screen.getByRole("button", { name: "Riprova" })).toBe(button);
  expect(button.hasAttribute("aria-disabled")).toBe(false);
  expect(button.hasAttribute("disabled")).toBe(false);
  expect(document.activeElement).toBe(button);
}
