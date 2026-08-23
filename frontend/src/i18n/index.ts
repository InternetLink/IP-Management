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
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Hydration-safe locale restoration runs after the initial client render.
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

  // Keep <html lang> in sync with the active locale AFTER hydration.
  // SSR and the first client render intentionally keep lang="en" (see note above);
  // this effect only runs on the client, so it cannot cause a hydration mismatch.
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  return createElement(I18nCtx.Provider, { value: { locale, setLocale, t: translations[locale], mounted } }, children);
}

export function useI18n() {
  return useContext(I18nCtx);
}

/**
 * Substitutes `{name}` placeholders in a translated string.
 * Values are coerced with String() so numbers can be passed directly.
 */
export function formatMessage(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : match,
  );
}

export const LOCALE_LABELS: Record<Locale, string> = {
  en: 'English',
  'zh-TW': '繁體中文',
};

/**
 * Compact locale codes for narrow viewports. These are identifiers rather than
 * translated prose, so they stay the same in every dictionary; the control's
 * accessible name always carries the full label.
 */
export const LOCALE_SHORT_LABELS: Record<Locale, string> = {
  en: 'EN',
  'zh-TW': 'TW',
};
