import * as SecureStore from 'expo-secure-store';
import { useLocales } from 'expo-localization';
import { createContext, Fragment, useContext, useEffect, useState, type ReactNode } from 'react';
import { I18nManager } from 'react-native';
import { choiceFromNativeDirection, setActiveLanguage, type Language } from './locale-state';

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

  useEffect(() => {
    const fallback = choiceFromNativeDirection(deviceLanguage, I18nManager.isRTL);
    void SecureStore.getItemAsync(STORAGE_KEY)
      .then((saved) => {
        const next = saved === 'en' || saved === 'he' ? saved : fallback;
        setActiveLanguage(next === 'system' ? deviceLanguage : next);
        setChoiceState(next);
      })
      .catch(() => {
        setActiveLanguage(fallback === 'system' ? deviceLanguage : fallback);
        setChoiceState(fallback);
      });
  }, [deviceLanguage]);

  useEffect(() => {
    if (!choice) return;
    I18nManager.allowRTL(choice === 'system' || language === 'he');
    I18nManager.swapLeftAndRightInRTL(true);
    I18nManager.forceRTL(choice === 'he');
  }, [choice, language]);

  function setChoice(next: LanguageChoice) {
    setActiveLanguage(next === 'system' ? deviceLanguage : next);
    setChoiceState(next);
    void SecureStore.setItemAsync(STORAGE_KEY, next).catch(() => undefined);
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
