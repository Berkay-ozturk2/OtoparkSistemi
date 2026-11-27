// Açık / koyu mod yönetimi.
// Seçim localStorage'da saklanır; seçim yoksa işletim sistemi tercihi izlenir.
// İlk boyamadan önce index.html içindeki küçük betik aynı kuralı uygular (parlama olmaz).

import { useCallback, useEffect, useState } from 'react';

export const THEME_KEY = 'akillipark_theme';
export const THEME_EVENT = 'akillipark:theme';

const media = () => window.matchMedia?.('(prefers-color-scheme: dark)');

function storedTheme() {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v === 'light' || v === 'dark' ? v : null;
  } catch {
    return null;
  }
}

export function systemTheme() {
  return media()?.matches ? 'dark' : 'light';
}

export function currentTheme() {
  return document.documentElement.getAttribute('data-bs-theme') === 'dark' ? 'dark' : 'light';
}

function applyTheme(mode) {
  const root = document.documentElement;
  root.setAttribute('data-bs-theme', mode);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', getComputedStyle(root).getPropertyValue('--ap-chrome-1').trim() || '#0e1626');
  window.dispatchEvent(new CustomEvent(THEME_EVENT, { detail: mode }));
}

/** CSS token değerini okur (grafik, harita gibi JS ile boyanan yerler için). */
export function cssToken(name, fallback = '') {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

/** Tema durumu ve değiştirici. Seçim yapılmadıkça sistem tercihi izlenir. */
export function useTheme() {
  const [theme, setThemeState] = useState(currentTheme);

  useEffect(() => {
    const onTheme = (e) => setThemeState(e.detail);
    window.addEventListener(THEME_EVENT, onTheme);
    const mq = media();
    const onSystem = () => {
      if (!storedTheme()) applyTheme(systemTheme());
    };
    mq?.addEventListener?.('change', onSystem);
    return () => {
      window.removeEventListener(THEME_EVENT, onTheme);
      mq?.removeEventListener?.('change', onSystem);
    };
  }, []);

  const setTheme = useCallback((mode) => {
    try {
      localStorage.setItem(THEME_KEY, mode);
    } catch {
      /* gizli sekme: yalnızca bu oturumda uygulanır */
    }
    applyTheme(mode);
  }, []);

  const toggle = useCallback(() => setTheme(currentTheme() === 'dark' ? 'light' : 'dark'), [setTheme]);

  return { theme, setTheme, toggle };
}
