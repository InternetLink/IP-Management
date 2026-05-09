"use client";

import type { TranslationKeys } from './en';
import type { ReactNode } from 'react';

import { createContext, createElement, useCallback, useContext, useEffect, useState } from 'react';
import en from './en';
import zhTW from './zh-TW';

export type Locale = 'en' | 'zh-TW';

const translations: Record<Locale, TranslationKeys> = { en, 'zh-TW': zhTW };

type I18nContext = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: TranslationKeys;
  mounted: boolean;
};

const I18nCtx = createContext<I18nContext>({
  locale: 'en',
  setLocale: () => {},
  t: en,
  mounted: false,
});

/**
 * I18n provider — uses 'en' as the SSR-safe default to match the <html lang="en">.
 * After mount, reads saved locale from localStorage and applies it.
 *
 * IMPORTANT: Both SSR and the initial client render MUST use the same locale ('en')
 * to prevent hydration mismatch. The real locale is applied in useEffect after hydration completes.
 */
export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>('en');
  const [mounted, setMounted] = useState(false);

  // Read saved locale AFTER mount to avoid SSR mismatch.
  // React guarantees useEffect runs only after hydration is complete.
  useEffect(() => {
    const saved = localStorage.getItem('ipam-locale') as Locale | null;
    if (saved && translations[saved]) {
      setLocaleState(saved);
    }
    // Don't auto-set zh-TW — let users choose via the language switcher.
    // This ensures SSR 'en' matches client 'en' until they explicitly change it.
    setMounted(true);
  }, []);

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    localStorage.setItem('ipam-locale', l);
  }, []);

  return createElement(I18nCtx.Provider, { value: { locale, setLocale, t: translations[locale], mounted } }, children);
}

export function useI18n() {
  return useContext(I18nCtx);
}

export const LOCALE_LABELS: Record<Locale, string> = {
  en: 'English',
  'zh-TW': '繁體中文',
};
