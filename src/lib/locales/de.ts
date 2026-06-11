import type { LocaleMessages } from "../types.ts";
import { enLocale } from "./en.ts";

export const deLocale: LocaleMessages = {
  ...enLocale,
  code: "de",
  ui: {
    ...enLocale.ui,
    languages: {
      it: "Italienisch",
      en: "Englisch",
      fr: "Franzoesisch",
      de: "Deutsch",
    },
  },
};
