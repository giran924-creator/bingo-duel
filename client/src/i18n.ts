import { uz } from "./locales/uz";
import { en } from "./locales/en";
import { ru } from "./locales/ru";
import { usePreferences } from "./store";
export function useText() {
  const lang = usePreferences((s) => s.settings.language);
  return { uz, en, ru }[lang];
}
export function errorText(code: string, lang: "uz" | "en" | "ru") {
  const d = { uz, en, ru }[lang];
  return d.errors[code as keyof typeof d.errors] ?? d.errors.SERVER_ERROR;
}
