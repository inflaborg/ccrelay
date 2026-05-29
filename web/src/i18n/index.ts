import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./en.json";
import zh from "./zh.json";

export type AppLocale = "en" | "zh";

const initialLocale = window.CCRELAY_LOCALE || undefined;

export function parseAppLocale(locale: unknown): AppLocale | undefined {
  return locale === "en" || locale === "zh" ? locale : undefined;
}

/** Apply UI language immediately and keep Electron/VS Code inject in sync. */
export async function applyAppLocale(locale: unknown): Promise<void> {
  const lng = parseAppLocale(locale);
  if (!lng) return;
  window.CCRELAY_LOCALE = lng;
  await i18n.changeLanguage(lng);
}

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    zh: { translation: zh },
  },
  lng: parseAppLocale(initialLocale) || "en",
  fallbackLng: "en",
  interpolation: { escapeValue: false },
  react: {
    useSuspense: false,
    bindI18n: "languageChanged loaded",
  },
});

export default i18n;
