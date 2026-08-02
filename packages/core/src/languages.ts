/** Display names for translation language codes found in the seed data. */
const LANGUAGE_LABELS: Record<string, string> = {
  en: 'English',
  cs: 'Čeština',
  de: 'Deutsch',
  fr: 'Français',
  it: 'Italiano',
  pt: 'Português',
  pl: 'Polski',
};

export function languageLabel(code: string): string {
  return LANGUAGE_LABELS[code] ?? code.toUpperCase();
}
