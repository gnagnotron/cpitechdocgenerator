import type { LocaleMessages } from "../types.ts";
import { enLocale } from "./en.ts";

export const frLocale: LocaleMessages = {
  ...enLocale,
  code: "fr",
  ui: {
    ...enLocale.ui,
    languages: {
      it: "Italien",
      en: "Anglais",
      fr: "Francais",
      de: "Allemand",
    },
  },
};
