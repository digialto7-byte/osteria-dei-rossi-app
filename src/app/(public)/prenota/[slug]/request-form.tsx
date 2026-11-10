"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  Button,
  Checkbox,
  ErrorAlert,
  Field,
  Heading,
  Muted,
  Select,
  SuccessNote,
  TextInput,
  linkClass,
} from "@/components/ui";
import { useHydrated } from "@/components/use-hydrated";
import { apiJson } from "@/lib/api/client";
import { latestOnly } from "@/lib/api/latest";
import { t } from "@/lib/i18n";
import { LOCALES, type Locale } from "@/lib/i18n/locale";
import { errorMessage, isClosedDay, partyChoices, telHref } from "@/lib/reservations/public-view";
import { SLUG_PATTERN } from "@/server/reservations/constants";
import type { PublicPage, SlotsReply } from "@/server/reservations/public/output";
import { PrivacyNotice } from "./privacy-notice";
import { SlotPicker, type Chosen } from "./slot-picker";

const MORE = "more";
type Slots = SlotsReply | "loading" | null;

/**
 * The public booking form. Everything it shows comes from /api/public/reservations/<slug>/{page,slots}; the request goes to .../requests. It decides no rule: the
 * database says which days and times are open, and a refused request comes back with a reason that this page only words, in the page's language. Customers never see a table.
 */
export function RequestForm({ slug, locale }: { slug: string; locale: Locale }) {
  const hydrated = useHydrated();
  // The slug comes from the address bar: one that is not a slug is "not available" without a request, and a valid one is encoded all the same.
  const validSlug = SLUG_PATTERN.test(slug);
  const base = `/api/public/reservations/${encodeURIComponent(slug)}`;
  const tt = (key: Parameters<typeof t>[0], values: Record<string, string | number> = {}) =>
    t(key, values, locale);

  const [page, setPage] = useState<PublicPage | null>(null);
  const [loadError, setLoadError] = useState<string | null>(
    validSlug ? null : t("publicReservationError.not_found", {}, locale),
  );
  const [date, setDate] = useState("");
  const [party, setParty] = useState("");
  const [slots, setSlots] = useState<Slots>(null);
  const [slotsNonce, setSlotsNonce] = useState(0);
  const [serviceKey, setServiceKey] = useState<string | undefined>(undefined);
  const [picked, setPicked] = useState<Chosen | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [website, setWebsite] = useState("");
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [startSlots] = useState(latestOnly);

  const loadPage = useCallback(async () => {
    if (!validSlug) return;
    const result = await apiJson<PublicPage>(`${base}/page`);
    if (!result.ok) {
      setLoadError(errorMessage(result.error, locale));
      return;
    }
    setLoadError(null);
    setPage(result.data);
    // The first party offered: two people, or the largest the page allows when that is fewer.
    setParty((current) => current || String(Math.min(2, result.data.maxPartyOnline)));
  }, [base, locale, validSlug]);

  useEffect(() => {
    // Reading the page's configuration when it opens is the effect's job here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadPage();
  }, [loadPage]);

  const closed =
    page !== null && date !== "" && isClosedDay(date, page.closedWeekdays, page.closedDates);
  const partyNumber = /^\d+$/.test(party) ? Number(party) : null;
  const wantsSlots = page !== null && date !== "" && partyNumber !== null && !closed;

  useEffect(() => {
    if (!wantsSlots) return;
    const isNewest = startSlots();
    // Asking for the times of the date and party that were just picked is the effect's job here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSlots("loading");
    void apiJson<SlotsReply>(`${base}/slots?date=${date}&party=${partyNumber}`).then((result) => {
      if (!isNewest()) return;
      if (result.ok) {
        setSlots(result.data);
        setError(null);
      } else {
        setSlots(null);
        setError(errorMessage(result.error, locale));
      }
    });
  }, [wantsSlots, date, partyNumber, slotsNonce, base, locale, startSlots]);

  const list = slots !== null && slots !== "loading" ? slots : null;
  const activeKey =
    list?.services.find((service) => service.key === serviceKey)?.key ?? list?.services[0]?.key;
  // A choice the latest times no longer offer (a place was taken meanwhile) is not a choice.
  const chosen =
    picked &&
    list?.services
      .find((service) => service.key === picked.serviceKey)
      ?.slots.some((slot) => slot.time === picked.time && slot.available)
      ? picked
      : null;
  const hasTimes = list?.services.some((service) => service.slots.length > 0) ?? false;

  const ready =
    hydrated &&
    !busy &&
    ack &&
    chosen !== null &&
    partyNumber !== null &&
    name.trim() !== "" &&
    phone.trim() !== "" &&
    email.trim() !== "";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!ready || !page || !chosen || partyNumber === null) return;
    setBusy(true);
    setError(null);
    const result = await apiJson<{ status: string }>(`${base}/requests`, {
      method: "POST",
      body: {
        date,
        serviceKey: chosen.serviceKey,
        time: chosen.time,
        party: partyNumber,
        name,
        phone,
        email,
        locale,
        privacyAck: true,
        website,
        formToken: page.formToken,
      },
    });
    setBusy(false);
    if (result.ok) {
      setSent(true);
      return;
    }
    setError(errorMessage(result.error, locale));
    if (result.error.code === "slot_unavailable") setSlotsNonce((n) => n + 1);
    // An old or unreadable form token: read the page again for a new one (what the customer typed stays).
    if (result.error.code === "form_expired" || result.error.code === "form_invalid")
      void loadPage();
  }

  const other = LOCALES.find((candidate) => candidate !== locale)!;
  const languageSwitch = (
    <nav aria-label={tt("publicReservation.lang.label")} className="flex gap-4 text-sm">
      {LOCALES.map((candidate) =>
        candidate === locale ? (
          <span key={candidate} aria-current="true" className="font-bold">
            {tt(`publicReservation.lang.${candidate}`)}
          </span>
        ) : (
          <a
            key={candidate}
            className={linkClass}
            href={`/prenota/${slug}${candidate === "en" ? "?lang=en" : ""}`}
            hrefLang={other}
          >
            {tt(`publicReservation.lang.${candidate}`)}
          </a>
        ),
      )}
    </nav>
  );

  if (page === null) {
    return (
      <div lang={locale} className="flex flex-col gap-4">
        {languageSwitch}
        {loadError ? (
          <ErrorAlert message={loadError} />
        ) : (
          <Muted>{tt("publicReservation.loading")}</Muted>
        )}
      </div>
    );
  }

  if (sent) {
    return (
      <div lang={locale} className="flex flex-col gap-4">
        {languageSwitch}
        <Heading>{page.venueName}</Heading>
        <SuccessNote role="status">{tt("publicReservation.sent")}</SuccessNote>
      </div>
    );
  }

  // "…chiamaci al {phone}.": the number is a tel: link, in whatever place the language puts it.
  const [beforePhone = "", afterPhone = ""] = tt("publicReservation.partyCall", {
    phone: "\u0000",
  }).split("\u0000");
  const callText =
    page.venuePhone !== null ? (
      <p>
        {beforePhone}
        <a className={linkClass} href={telHref(page.venuePhone)}>
          {page.venuePhone}
        </a>
        {afterPhone}
      </p>
    ) : (
      <p>{tt("publicReservation.partyCallNoPhone")}</p>
    );

  return (
    <div lang={locale} className="flex flex-col gap-5">
      {languageSwitch}
      <div className="flex flex-col gap-2">
        <Heading>{page.venueName}</Heading>
        <Muted>{tt("publicReservation.title")}</Muted>
        <Muted>{tt("publicReservation.intro")}</Muted>
      </div>

      <form
        method="post"
        data-hydrated={hydrated ? "true" : undefined}
        onSubmit={submit}
        className="flex flex-col gap-4"
      >
        <Field label={tt("publicReservation.date")}>
          <TextInput
            type="date"
            name="date"
            value={date}
            min={page.minDate}
            max={page.maxDate}
            onChange={(event) => {
              setDate(event.target.value);
              setPicked(null);
              setError(null);
            }}
          />
        </Field>
        <Field label={tt("publicReservation.party")}>
          <Select
            name="party"
            value={party}
            onChange={(event) => {
              setParty(event.target.value);
              setPicked(null);
              setError(null);
            }}
          >
            {partyChoices(page.maxPartyOnline).map((count) => (
              <option key={count} value={String(count)}>
                {count}
              </option>
            ))}
            <option value={MORE}>
              {tt("publicReservation.partyMore", { max: page.maxPartyOnline })}
            </option>
          </Select>
        </Field>

        {party === MORE ? (
          <div
            role="status"
            className="rounded-lg border-l-4 border-warning bg-warning-bg px-4 py-3 text-warning"
          >
            {callText}
          </div>
        ) : (
          <>
            {date === "" ? <Muted>{tt("publicReservation.pickDate")}</Muted> : null}
            {closed || list?.closed ? (
              <Muted>{tt("publicReservation.closed")}</Muted>
            ) : slots === "loading" ? (
              <Muted>{tt("publicReservation.slotsLoading")}</Muted>
            ) : list && !hasTimes ? (
              <Muted>{tt("publicReservation.noSlots")}</Muted>
            ) : list ? (
              <SlotPicker
                services={list.services}
                activeKey={activeKey}
                chosen={chosen}
                locale={locale}
                onTab={setServiceKey}
                onPick={setPicked}
              />
            ) : null}

            <Field label={tt("publicReservation.name")}>
              <TextInput
                name="name"
                autoComplete="name"
                maxLength={80}
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </Field>
            <Field label={tt("publicReservation.phone")}>
              <TextInput
                name="phone"
                type="tel"
                autoComplete="tel"
                inputMode="tel"
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
              />
            </Field>
            <Field label={tt("publicReservation.email")}>
              <TextInput
                name="email"
                type="email"
                autoComplete="email"
                maxLength={254}
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </Field>

            {/* The honeypot: a person never sees it or reaches it with the keyboard; a script that fills every field does. */}
            <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
              <label>
                {tt("publicReservation.honeypot")}
                <input
                  name="website"
                  type="text"
                  className="min-h-tap"
                  tabIndex={-1}
                  autoComplete="off"
                  value={website}
                  onChange={(event) => setWebsite(event.target.value)}
                />
              </label>
            </div>

            <PrivacyNotice privacy={page.privacy} locale={locale} />
            <Checkbox
              name="privacyAck"
              label={tt("publicReservation.privacy.ack")}
              checked={ack}
              onChange={(event) => setAck(event.target.checked)}
            />
            <ErrorAlert message={error} />
            <Button type="submit" disabled={!ready}>
              {busy ? tt("publicReservation.sending") : tt("publicReservation.submit")}
            </Button>
          </>
        )}
      </form>
    </div>
  );
}
