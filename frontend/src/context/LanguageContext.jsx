import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { translations } from '../i18n/translations';

const LanguageContext = createContext(null);
const STORAGE_KEY = 'janggi_language';
const SUPPORTED = ['ko', 'en'];

const resolveKey = (obj, key) =>
  key.split('.').reduce((acc, part) => (acc && acc[part] != null ? acc[part] : undefined), obj);

const detectInitialLanguage = () => {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (SUPPORTED.includes(saved)) return saved;

  const browser = navigator.language?.toLowerCase() || 'en';
  return browser.startsWith('ko') ? 'ko' : 'en';
};

export const LanguageProvider = ({ children }) => {
  const [language, setLanguageState] = useState(detectInitialLanguage);

  const setLanguage = useCallback((nextLanguage) => {
    if (!SUPPORTED.includes(nextLanguage)) return;
    setLanguageState(nextLanguage);
    localStorage.setItem(STORAGE_KEY, nextLanguage);
  }, []);

  const t = useCallback(
    (key, params = {}) => {
      const template =
        resolveKey(translations[language], key) ??
        resolveKey(translations.en, key) ??
        key;

      if (typeof template !== 'string') return key;
      return template.replace(/\{\{(\w+)\}\}/g, (_match, paramKey) =>
        params[paramKey] != null ? String(params[paramKey]) : '',
      );
    },
    [language],
  );

  const value = useMemo(
    () => ({
      language,
      setLanguage,
      t,
    }),
    [language, setLanguage, t],
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
};

export const useLanguage = () => {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error('useLanguage must be used within LanguageProvider');
  }
  return context;
};
