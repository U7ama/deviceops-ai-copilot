'use client';

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

export const palettes = [
  ['vercel', 'Vercel'], ['claude', 'Claude'], ['discord', 'Discord'],
  ['supabase', 'Supabase'], ['mono', 'Mono'], ['notebook', 'Notebook'],
  ['light-green', 'Light Green'], ['zen', 'Zen'], ['astro-vista', 'Astro Vista'],
  ['whatsapp', 'WhatsApp']
] as const;
export type Palette = typeof palettes[number][0];
export type ThemePreference = 'light' | 'dark' | 'system';

interface ThemeState {
  preference: ThemePreference;
  palette: Palette;
  resolved: 'light' | 'dark';
  setPreference: (value: ThemePreference) => void;
  setPalette: (value: Palette) => void;
}
const ThemeContext = createContext<ThemeState | null>(null);

function applyMode(value: ThemePreference): 'light' | 'dark' {
  const resolved = value === 'system'
    ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : value;
  const html = document.documentElement;
  html.dataset.theme = resolved;
  html.dataset.themePreference = value;
  html.classList.toggle('dark', resolved === 'dark');
  html.style.colorScheme = resolved;
  return resolved;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, updatePreference] = useState<ThemePreference>('system');
  const [palette, updatePalette] = useState<Palette>('vercel');
  const [resolved, setResolved] = useState<'light' | 'dark'>('light');
  const currentPreference = useRef<ThemePreference>('system');

  useEffect(() => {
    // The preload script has already validated and applied these values.
    const html = document.documentElement;
    const initial = html.dataset.themePreference;
    const mode: ThemePreference = initial === 'light' || initial === 'dark' ? initial : 'system';
    const color = palettes.find(([value]) => value === html.dataset.palette)?.[0] ?? 'vercel';
    currentPreference.current = mode;
    updatePreference(mode);
    updatePalette(color);
    html.dataset.palette = color;
    setResolved(applyMode(mode));
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => {
      if (currentPreference.current === 'system') setResolved(applyMode('system'));
    };
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  function setPreference(value: ThemePreference) {
    currentPreference.current = value;
    updatePreference(value);
    try { localStorage.setItem('deviceops-theme', value); } catch { /* Preferences still work in memory. */ }
    setResolved(applyMode(value));
  }
  function setPalette(value: Palette) {
    updatePalette(value);
    document.documentElement.dataset.palette = value;
    try { localStorage.setItem('deviceops-palette', value); } catch { /* Preferences still work in memory. */ }
  }

  return <ThemeContext.Provider value={{ preference, palette, resolved, setPreference, setPalette }}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeState {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('Theme controls require ThemeProvider.');
  return context;
}
