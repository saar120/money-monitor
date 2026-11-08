import * as SecureStore from 'expo-secure-store';
import { useLocales } from 'expo-localization';
import { router, usePathname } from 'expo-router';
import {
  createContext,
  Fragment,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { I18nManager } from 'react-native';
import { choiceFromNativeDirection, setActiveLanguage, type Language } from './locale-state';
import { rootTabFromPath } from './navigation-state';

export type LanguageChoice = 'system' | 'en' | 'he';
export type { Language } from './locale-state';
export { currentLocale } from './locale-state';

const STORAGE_KEY = 'money-monitor-language';
type LanguageContextValue = {
  choice: LanguageChoice;
  language: Language;
  setChoice: (choice: LanguageChoice) => void;
};

const LanguageContext = createContext<LanguageContextValue | null>(null);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const locales = useLocales();
  const deviceLanguage: Language = locales[0]?.languageCode === 'he' ? 'he' : 'en';
  const [choice, setChoiceState] = useState<LanguageChoice | null>(null);
  const language = !choice || choice === 'system' ? deviceLanguage : choice;
  if (choice) setActiveLanguage(language);
  const pathname = usePathname();
  const settingsHandoff = useRef<{ id: number; language: Language } | null>(null);
  const choiceGeneration = useRef(0);
  const preferenceWrites = useRef<Promise<void>>(Promise.resolve());

  // The language key below remounts navigation at a root tab; return to the screen that changed it.
  useEffect(() => {
    const handoff = settingsHandoff.current;
    if (
      !handoff ||
      handoff.id !== choiceGeneration.current ||
      handoff.language !== language ||
      !rootTabFromPath(pathname)
    )
      return;
    settingsHandoff.current = null;
    router.push('/settings');
  }, [pathname, language]);

  useEffect(() => {
    if (choice !== null) return;
    const generation = choiceGeneration.current;
    let current = true;
    const fallback = choiceFromNativeDirection(deviceLanguage, I18nManager.isRTL);
    void SecureStore.getItemAsync(STORAGE_KEY)
      .then((saved) => {
        if (!current || generation !== choiceGeneration.current) return;
        const next = saved === 'en' || saved === 'he' ? saved : fallback;
        setActiveLanguage(next === 'system' ? deviceLanguage : next);
        setChoiceState(next);
      })
      .catch(() => {
        if (!current || generation !== choiceGeneration.current) return;
        setActiveLanguage(fallback === 'system' ? deviceLanguage : fallback);
        setChoiceState(fallback);
      });
    return () => {
      current = false;
    };
  }, [deviceLanguage]);

  useEffect(() => {
    if (!choice) return;
    I18nManager.allowRTL(choice === 'system' || language === 'he');
    I18nManager.swapLeftAndRightInRTL(true);
    I18nManager.forceRTL(choice === 'he');
  }, [choice, language]);

  function setChoice(next: LanguageChoice) {
    choiceGeneration.current++;
    const nextLanguage = next === 'system' ? deviceLanguage : next;
    settingsHandoff.current =
      nextLanguage !== language ? { id: choiceGeneration.current, language: nextLanguage } : null;
    setActiveLanguage(nextLanguage);
    setChoiceState(next);
    preferenceWrites.current = preferenceWrites.current
      .catch(() => {})
      .then(() => SecureStore.setItemAsync(STORAGE_KEY, next));
    void preferenceWrites.current.catch(() => {});
  }

  if (!choice) return null;

  return (
    <LanguageContext.Provider value={{ choice, language, setChoice }}>
      <Fragment key={language}>{children}</Fragment>
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const value = useContext(LanguageContext);
  if (!value) throw new Error('useLanguage must be used inside LanguageProvider');
  return value;
}

export { t } from './translations';
