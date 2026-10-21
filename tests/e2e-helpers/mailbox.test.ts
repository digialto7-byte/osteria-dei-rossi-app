import { afterEach, describe, expect, it, vi } from "vitest";
import { latestLinkFor } from "../../e2e/helpers/mailbox";

afterEach(() => vi.unstubAllGlobals());

describe("latestLinkFor (E2E mailbox helper)", () => {
  it("never puts the email text into its error message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        Response.json(
          url.includes("/api/v1/messages")
            ? { messages: [{ ID: "msg-1", To: [{ Address: "owner@example.test" }] }] }
            : { Text: "Ciao Mario Rossi, ecco i tuoi dati privati" },
        ),
      ),
    );
    const error = await latestLinkFor("http://mailpit", "owner@example.test").catch(
      (e: Error) => e,
    );
    expect(String(error)).toContain("msg-1");
    expect(String(error)).not.toContain("Mario Rossi");
  });

  it("returns the verify link of the newest mail for the address", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        Response.json(
          url.includes("/api/v1/messages")
            ? { messages: [{ ID: "msg-2", To: [{ Address: "Owner@Example.test" }] }] }
            : { Text: "Accedi: http://127.0.0.1:54321/auth/v1/verify?token=abc&type=magiclink)" },
        ),
      ),
    );
    await expect(latestLinkFor("http://mailpit", "owner@example.test")).resolves.toBe(
      "http://127.0.0.1:54321/auth/v1/verify?token=abc&type=magiclink",
    );
  });
});
