import { describe, expect, it } from "vitest";
import { ConfigError, readAppOrigin, readConsoleHost } from "@/lib/env";

// SP3 step 16 (plan §3.5): CONSOLE_HOST is a host with an optional port; APP_ORIGIN is an origin with a scheme and nothing after it.
function rejected(read: () => unknown, name: string, value: string) {
  try {
    read();
    expect.unreachable();
  } catch (error) {
    expect(error).toBeInstanceOf(ConfigError);
    expect((error as ConfigError).variables).toEqual([name]);
    expect((error as ConfigError).message).not.toContain(value);
  }
}

describe("readConsoleHost", () => {
  it.each(["console.example.com", "console.example.com:8443", "127.0.0.1:3000", "localhost:3000"])(
    "accepts %s",
    (host) => {
      expect(readConsoleHost({ CONSOLE_HOST: host })).toBe(host);
    },
  );

  it("is undefined when unset or blank: no console anywhere (Q-P12)", () => {
    expect(readConsoleHost({})).toBeUndefined();
    expect(readConsoleHost({ CONSOLE_HOST: "" })).toBeUndefined();
  });

  it.each([
    "https://console.example.com",
    "console.example.com/",
    "console.example.com/locali",
    "Console.Example.com",
    " console.example.com",
    "console.example.com:",
    ":3000",
    "console.example.com:0",
    "console.example.com:65536",
    "console.example.com:80",
    "console.example.com:443",
    "127.0.0.1:03000",
    "127.0.0.1:00080",
    "console.example.com:3000:1",
    "a@console.example.com",
    "-console.example.com",
    "console..example.com",
    "console.example.com.",
  ])("rejects %j, naming the variable", (host) => {
    rejected(() => readConsoleHost({ CONSOLE_HOST: host }), "CONSOLE_HOST", host);
  });
});

describe("readAppOrigin", () => {
  it.each(["https://app.example.com", "http://localhost:3000", "https://app.example.com:8443"])(
    "accepts %s",
    (origin) => {
      expect(readAppOrigin({ APP_ORIGIN: origin })).toBe(origin);
    },
  );

  it("is undefined when unset or blank", () => {
    expect(readAppOrigin({})).toBeUndefined();
    expect(readAppOrigin({ APP_ORIGIN: "" })).toBeUndefined();
  });

  it.each([
    "app.example.com",
    "localhost:3000",
    "https://app.example.com/",
    "https://app.example.com/login",
    "https://app.example.com?a=1",
    "https://app.example.com#a",
    "https://user@app.example.com",
    "https://APP.example.com",
    "ftp://app.example.com",
    "javascript:alert(1)",
    " https://app.example.com",
  ])("rejects %j, naming the variable", (origin) => {
    rejected(() => readAppOrigin({ APP_ORIGIN: origin }), "APP_ORIGIN", origin);
  });
});
