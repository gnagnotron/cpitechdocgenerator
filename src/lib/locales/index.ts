import type { LanguageCode, LocaleMessages } from "../types.ts";
import { deLocale } from "./de.ts";
import { enLocale } from "./en.ts";
import { frLocale } from "./fr.ts";
import { itLocale } from "./it.ts";

const localeMap: Record<LanguageCode, LocaleMessages> = {
  it: itLocale,
  en: enLocale,
  fr: frLocale,
  de: deLocale,
};

export const getLocaleMessages = (language: LanguageCode = "it") => localeMap[language] ?? itLocale;

export const supportedLanguages = Object.keys(localeMap) as LanguageCode[];
