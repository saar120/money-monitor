export type Language = 'en' | 'he';

export function choiceFromNativeDirection(deviceLanguage: Language, isRTL: boolean) {
  if (isRTL === (deviceLanguage === 'he')) return 'system' as const;
  return isRTL ? ('he' as const) : ('en' as const);
}

let activeLanguage: Language = Intl.DateTimeFormat().resolvedOptions().locale.startsWith('he')
  ? 'he'
  : 'en';

export function setActiveLanguage(language: Language) {
  activeLanguage = language;
}

export function currentLanguage(): Language {
  return activeLanguage;
}

export function currentLocale(): string {
  return activeLanguage === 'he' ? 'he-IL' : 'en';
}

export function formatMonthShort(month: string): string {
  return new Intl.DateTimeFormat(currentLocale(), { month: 'short', timeZone: 'UTC' }).format(
    new Date(`${month}-01T12:00:00Z`),
  );
}
