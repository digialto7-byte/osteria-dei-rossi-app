import { describe, expect, it } from "vitest";
import {
  emailRowsSql,
  FAKE_HASH_SALT,
  lastLine,
  moveToDaySql,
  quoteLiteral,
  requestSql,
  type RequestSeed,
} from "./reservations";

const TENANT = "11111111-1111-4111-8111-111111111111";
const RESERVATION = "23000000-0000-4000-8000-000000000001";
const SEED: RequestSeed = {
  date: "2026-11-21",
  time: "19:30",
  serviceKey: "cena",
  party: 3,
  name: "Cliente Demo",
  phone: "+39 000 0000001",
  email: "cliente.demo@example.com",
  ip: "203.0.113.10",
};

describe("quoteLiteral", () => {
  it("doubles quotes so a value can never end the literal", () => {
    expect(quoteLiteral("O'Rossi")).toBe("'O''Rossi'");
    expect(quoteLiteral("a'; drop table x; --")).toBe("'a''; drop table x; --'");
  });
  it("refuses a backslash or a NUL (no escape syntax, no surprises)", () => {
    expect(() => quoteLiteral("a\\b")).toThrow();
    expect(() => quoteLiteral("a\0b")).toThrow();
  });
});

describe("requestSql", () => {
  const sql = requestSql(TENANT, SEED);

  it("creates the hash salt only when it is missing, then calls the twin of request_reservation with p_now = now()", () => {
    expect(sql).toContain("vault.create_secret");
    expect(sql).toContain(
      "where not exists (select 1 from vault.secrets where name = 'reservation_hash_salt')",
    );
    expect(sql).toContain(`'${FAKE_HASH_SALT}'`);
    expect(sql).toContain(`app.request_reservation_at('${TENANT}'`);
    expect(sql.trim().endsWith(", now())")).toBe(true);
  });

  it("sends exactly the nine keys of the body, with the privacy notice version", () => {
    const body = /'(\{.*\})'::jsonb/.exec(sql)![1]!;
    expect(Object.keys(JSON.parse(body)).sort()).toEqual([
      "date",
      "email",
      "locale",
      "name",
      "party",
      "phone",
      "privacyNoticeVersion",
      "serviceKey",
      "time",
    ]);
    expect(JSON.parse(body)).toMatchObject({ party: 3, serviceKey: "cena", locale: "it" });
  });

  it("refuses a tenant that is not a uuid and an IP that is not an address", () => {
    expect(() => requestSql("x'; select 1; --", SEED)).toThrow();
    expect(() => requestSql(TENANT, { ...SEED, ip: "1.2.3.4'; --" })).toThrow();
  });

  it("a name with a quote is escaped", () => {
    expect(requestSql(TENANT, { ...SEED, name: "Cliente D'Oro (demo)" })).toContain(
      "Cliente D''Oro (demo)",
    );
  });
});

describe("moveToDaySql and emailRowsSql", () => {
  it("moves the booking to the given business date, one hour from now, and touches only that booking", () => {
    const sql = moveToDaySql(RESERVATION, "2026-11-20");
    expect(sql).toContain("business_date = '2026-11-20'");
    expect(sql).toContain("starts_at = now() + interval '1 hour'");
    expect(sql).toContain(`id = '${RESERVATION}'`);
  });
  it("refuses a date that is not a calendar date", () => {
    expect(() => moveToDaySql(RESERVATION, "2026-11-20'; --")).toThrow();
  });
  it("reads the outbox rows of one booking, without any address", () => {
    const sql = emailRowsSql(RESERVATION);
    expect(sql).toContain("from public.reservation_email");
    expect(sql).not.toMatch(/email\b[^_]*from public\.reservation_contact/);
    expect(sql).toContain(`reservation_id = '${RESERVATION}'`);
  });
});

describe("lastLine", () => {
  it("is the reply even when the Vault secret's id printed before it", () => {
    expect(lastLine('3f49826d-4dab-4878-8b2d-f9c42055c5f5\n{"status": "received"}\n')).toBe(
      '{"status": "received"}',
    );
    expect(lastLine('{"status": "received"}')).toBe('{"status": "received"}');
    expect(lastLine("")).toBe("");
  });
});
