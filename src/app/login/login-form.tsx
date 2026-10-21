"use client";

import { useState, type FormEvent } from "react";
import { t } from "@/lib/i18n";

type Status = "idle" | "sending" | "sent" | "error";

export function LoginForm({ next }: { next: string | undefined }) {
  const [status, setStatus] = useState<Status>("idle");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = new FormData(event.currentTarget).get("email");
    setStatus("sending");
    const response = await fetch("/api/auth/magic-link", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, next }),
    }).catch(() => null);
    setStatus(response?.status === 202 ? "sent" : "error");
  }

  if (status === "sent") {
    return (
      <p role="status" className="rounded border border-green-300 bg-green-50 p-3 text-green-900">
        {t("login.sent")}
      </p>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <label htmlFor="email" className="font-medium">
        {t("login.email")}
      </label>
      <input
        id="email"
        name="email"
        type="email"
        autoComplete="email"
        required
        className="min-h-tap rounded border border-stone-400 bg-white px-3 text-base"
      />
      <button
        type="submit"
        disabled={status === "sending"}
        className="min-h-tap rounded bg-brand px-4 font-semibold text-brand-contrast disabled:opacity-60"
      >
        {t("login.submit")}
      </button>
      {status === "error" && (
        <p role="alert" className="text-red-800">
          {t("login.error")}
        </p>
      )}
    </form>
  );
}
