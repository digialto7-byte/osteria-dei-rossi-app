import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { STAGING_PROJECT_REF } from "../../../scripts/lib/demo/target";
import { checkConnectorRef, resolveSpikeTarget } from "../../../scripts/lib/sp00/target";

const TEMP_REF = "abcdefghijklmnopqrst";
const TEMP_URL = `https://${TEMP_REF}.supabase.co`;
const PROD_REF = "zyxwvutsrqponmlkjihg";
const OK_ENV = { SPIKE_TEMP_OK: "yes", SPIKE_PROJECT_REF: TEMP_REF };

const refusal = (fn: () => unknown): string => {
  try {
    fn();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error("expected a refusal, but nothing was thrown");
};

const resolveTemp = (supabaseUrl: string, env: Record<string, string | undefined> = OK_ENV) =>
  resolveSpikeTarget({ target: "temp", env, supabaseUrl });

describe("the staging ref literal (lead requirement)", () => {
  it("is the staging project, written in code and reused from the demo target", () => {
    expect(STAGING_PROJECT_REF).toBe("wjowhjsfpcdykxwgjipq");
  });
});

describe("resolveSpikeTarget: local", () => {
  it.each(["http://127.0.0.1:54321", "http://localhost:54321"])("accepts %s", (url) => {
    expect(resolveSpikeTarget({ target: "local", env: {}, supabaseUrl: url })).toEqual({
      target: "local",
      ref: null,
    });
  });

  it("refuses a hosted URL", () => {
    expect(
      refusal(() => resolveSpikeTarget({ target: "local", env: {}, supabaseUrl: TEMP_URL })),
    ).toMatch(/not the local stack/);
  });

  it.each(["http://127.0.0.1.evil.test", "http://localhost.evil.test", "not a url", ""])(
    "refuses the look-alike or broken URL %j",
    (url) => {
      expect(() => resolveSpikeTarget({ target: "local", env: {}, supabaseUrl: url })).toThrow(
        /not the local stack/,
      );
    },
  );

  it("refuses credentials in a local URL", () => {
    expect(() =>
      resolveSpikeTarget({
        target: "local",
        env: {},
        supabaseUrl: "http://user:pw@127.0.0.1:54321",
      }),
    ).toThrow(/not the local stack/);
  });
});

describe("resolveSpikeTarget: temp", () => {
  it("accepts the exact https://<ref>.supabase.co", () => {
    expect(resolveTemp(TEMP_URL)).toEqual({ target: "temp", ref: TEMP_REF });
    expect(resolveTemp(`${TEMP_URL}/`)).toEqual({ target: "temp", ref: TEMP_REF });
  });

  it("refuses without SPIKE_TEMP_OK=yes", () => {
    expect(() => resolveTemp(TEMP_URL, { SPIKE_PROJECT_REF: TEMP_REF })).toThrow(/SPIKE_TEMP_OK/);
    expect(() =>
      resolveTemp(TEMP_URL, { SPIKE_PROJECT_REF: TEMP_REF, SPIKE_TEMP_OK: "true" }),
    ).toThrow(/SPIKE_TEMP_OK/);
  });

  it("refuses when SPIKE_PROJECT_REF is missing or malformed", () => {
    expect(() => resolveTemp(TEMP_URL, { SPIKE_TEMP_OK: "yes" })).toThrow(/SPIKE_PROJECT_REF/);
    expect(() =>
      resolveTemp(TEMP_URL, { SPIKE_TEMP_OK: "yes", SPIKE_PROJECT_REF: "Not A Ref!" }),
    ).toThrow(/SPIKE_PROJECT_REF/);
  });

  it.each([
    ["a port", `${TEMP_URL}:8443`],
    ["the default port written out", `${TEMP_URL}:443`],
    ["a path", `${TEMP_URL}/rest/v1`],
    ["credentials", `https://user:pw@${TEMP_REF}.supabase.co`],
    ["http", `http://${TEMP_REF}.supabase.co`],
    ["a look-alike host", `https://${TEMP_REF}.supabase.co.evil.test`],
    ["a look-alike prefix", `https://x${TEMP_REF}.supabase.co`],
    ["a query", `${TEMP_URL}/?a=1`],
    ["another ref", "https://bbbbbbbbbbbbbbbbbbbb.supabase.co"],
    ["no URL", "not a url"],
  ])("refuses %s", (_name, url) => {
    expect(() => resolveTemp(url)).toThrow(/temporary project/);
  });

  it("messages never contain the URL, the ref or a key", () => {
    for (const url of [`${TEMP_URL}:8443`, "https://bbbbbbbbbbbbbbbbbbbb.supabase.co"]) {
      const message = refusal(() => resolveTemp(url));
      expect(message).not.toContain("supabase.co");
      expect(message).not.toContain(TEMP_REF);
      expect(message).not.toContain("bbbbbbbbbbbbbbbbbbbb");
    }
  });
});

describe("script target guard refuses the staging project by name", () => {
  const STAGING_URL = `https://${STAGING_PROJECT_REF}.supabase.co`;

  it("refuses the staging URL when no STAGING_PROJECT_REF env var is set", () => {
    const message = refusal(() =>
      resolveTemp(STAGING_URL, { SPIKE_TEMP_OK: "yes", SPIKE_PROJECT_REF: STAGING_PROJECT_REF }),
    );
    expect(message).toMatch(/staging project/);
    expect(message).not.toContain(STAGING_PROJECT_REF);
  });

  it("refuses the staging URL even when SPIKE_PROJECT_REF names another project", () => {
    expect(refusal(() => resolveTemp(STAGING_URL))).toMatch(/staging project/);
  });

  it("refuses SPIKE_PROJECT_REF set to the staging ref with a different URL", () => {
    expect(
      refusal(() =>
        resolveTemp(TEMP_URL, { SPIKE_TEMP_OK: "yes", SPIKE_PROJECT_REF: STAGING_PROJECT_REF }),
      ),
    ).toMatch(/staging project/);
  });

  it("refuses the staging ref given only by the STAGING_PROJECT_REF variable, too", () => {
    const env = { ...OK_ENV, STAGING_PROJECT_REF: TEMP_REF };
    expect(refusal(() => resolveTemp(TEMP_URL, env))).toMatch(/staging project/);
  });
});

describe("production ref (from the environment; no value is in the repo)", () => {
  it("refuses a target equal to PRODUCTION_PROJECT_REF", () => {
    const env = { ...OK_ENV, PRODUCTION_PROJECT_REF: TEMP_REF };
    const message = refusal(() => resolveTemp(TEMP_URL, env));
    expect(message).toMatch(/production project/);
    expect(message).not.toContain(TEMP_REF);
  });

  it("an unset or empty PRODUCTION_PROJECT_REF refuses nothing extra", () => {
    expect(resolveTemp(TEMP_URL, { ...OK_ENV, PRODUCTION_PROJECT_REF: "" }).ref).toBe(TEMP_REF);
  });
});

describe("checkConnectorRef (the connector's project_id)", () => {
  it("accepts SPIKE_PROJECT_REF itself", () => {
    expect(() => checkConnectorRef(TEMP_REF, OK_ENV)).not.toThrow();
  });

  it("refuses a ref other than SPIKE_PROJECT_REF", () => {
    expect(refusal(() => checkConnectorRef("bbbbbbbbbbbbbbbbbbbb", OK_ENV))).toMatch(
      /not the declared temporary project/,
    );
  });

  it("refuses when SPIKE_PROJECT_REF is not set", () => {
    expect(() => checkConnectorRef(TEMP_REF, {})).toThrow(/SPIKE_PROJECT_REF/);
  });

  it("refuses the staging ref by name with no env var set at all", () => {
    const message = refusal(() => checkConnectorRef(STAGING_PROJECT_REF, {}));
    expect(message).toMatch(/staging project/);
    expect(message).not.toContain(STAGING_PROJECT_REF);
  });

  it("refuses the staging ref even if SPIKE_PROJECT_REF was set to it", () => {
    expect(
      refusal(() =>
        checkConnectorRef(STAGING_PROJECT_REF, { SPIKE_PROJECT_REF: STAGING_PROJECT_REF }),
      ),
    ).toMatch(/staging project/);
  });

  it("refuses PRODUCTION_PROJECT_REF and STAGING_PROJECT_REF from the environment", () => {
    expect(
      refusal(() =>
        checkConnectorRef(PROD_REF, {
          SPIKE_PROJECT_REF: PROD_REF,
          PRODUCTION_PROJECT_REF: PROD_REF,
        }),
      ),
    ).toMatch(/production project/);
    expect(
      refusal(() =>
        checkConnectorRef(PROD_REF, { SPIKE_PROJECT_REF: PROD_REF, STAGING_PROJECT_REF: PROD_REF }),
      ),
    ).toMatch(/staging project/);
  });

  it("refuses an empty or malformed ref", () => {
    expect(() => checkConnectorRef("", OK_ENV)).toThrow(/project ref/);
    expect(() => checkConnectorRef("a b", OK_ENV)).toThrow(/project ref/);
  });
});

describe("scripts/spike/sp00-ref-check.ts (run as the lead runs it)", () => {
  const run = (args: string[], env: Record<string, string>) =>
    spawnSync("npx", ["tsx", "scripts/spike/sp00-ref-check.ts", ...args], {
      env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", NODE_ENV: "test", ...env },
      encoding: "utf8",
    });

  it("prints ok and exits 0 for the declared ref", () => {
    const result = run([TEMP_REF], { SPIKE_PROJECT_REF: TEMP_REF });
    expect(result.stdout.trim()).toBe("ok");
    expect(result.status).toBe(0);
  });

  it("refuses the staging ref by name, exits 1, with no STAGING_PROJECT_REF set", () => {
    const result = run([STAGING_PROJECT_REF], { SPIKE_PROJECT_REF: TEMP_REF });
    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toMatch(/staging project/);
    expect(result.stderr).not.toContain(STAGING_PROJECT_REF);
  });

  it("exits 1 with a usage line when no ref is given", () => {
    const result = run([], { SPIKE_PROJECT_REF: TEMP_REF });
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/usage/i);
  });
});
