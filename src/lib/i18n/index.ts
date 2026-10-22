import { DEFAULT_LOCALE, type Locale } from "./locale";
import { en } from "./messages/en";
import { it } from "./messages/it";
import type { MessageKey } from "./messages/keys";

export type { MessageKey };
export const messages: Record<Locale, Record<MessageKey, string>> = { it, en };

const PLACEHOLDER = /\{(\w+)\}/g;

/** True for a key of the catalogues, e.g. to translate a code the server sent. */
export function isMessageKey(key: string): key is MessageKey {
  return key in messages.it;
}

/** Looks up a message and fills `{name}` placeholders; unknown placeholders stay visible. */
export function t(
  key: MessageKey,
  values: Record<string, string | number> = {},
  locale: Locale = DEFAULT_LOCALE,
): string {
  return messages[locale][key].replace(PLACEHOLDER, (match, name: string) =>
    name in values ? String(values[name]) : match,
  );
}

type PluralBase = MessageKey extends infer K
  ? K extends `${infer Base}.one`
    ? Base
    : never
  : never;

/** A message with a singular and a plural form (`<base>.one` / `<base>.other`); `{count}` is filled in. */
export function tn(base: PluralBase, count: number, locale: Locale = DEFAULT_LOCALE): string {
  return t(`${base}.${count === 1 ? "one" : "other"}` as MessageKey, { count }, locale);
}
