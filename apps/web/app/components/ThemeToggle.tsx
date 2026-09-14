'use client';

import { useEffect, useRef, useState } from 'react';
import { Sun, Moon, Monitor } from 'lucide-react';

type ThemePref = 'light' | 'dark' | 'system';

function resolveTheme(pref: ThemePref): 'light' | 'dark' {
  if (pref === 'system') {
    if (typeof window !== 'undefined' && window.matchMedia) {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    return 'light';
  }
  return pref;
}

function applyTheme(pref: ThemePref): 'light' | 'dark' {
  const resolved = resolveTheme(pref);
  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('data-theme', resolved);
    document.documentElement.setAttribute('data-theme-preference', pref);
    document.documentElement.style.colorScheme = resolved;
  }
  return resolved;
}

export function ThemeToggle() {
  const [preference, setPreference] = useState<ThemePref>('system');
  const currentPreference = useRef<ThemePref>('system');
  const [resolved, setResolved] = useState<'light' | 'dark'>('light');
  const [systemIsDark, setSystemIsDark] = useState(false);

  useEffect(() => {
    let initialPref: ThemePref = 'system';
    try {
      const stored = localStorage.getItem('deviceops-theme') as ThemePref | null;
      if (stored && ['light', 'dark', 'system'].includes(stored)) {
        initialPref = stored;
      }
    } catch {}

    const media = window.matchMedia('(prefers-color-scheme: dark)');
    setSystemIsDark(media.matches);
    setPreference(initialPref);
    currentPreference.current = initialPref;
    const active = applyTheme(initialPref);
    setResolved(active);

    const onMediaChange = (e: MediaQueryListEvent | MediaQueryList) => {
      setSystemIsDark(e.matches);
      if (currentPreference.current === 'system') {
        setResolved(applyTheme('system'));
      }
    };

    if (media.addEventListener) {
      media.addEventListener('change', onMediaChange);
    } else if ((media as any).addListener) {
      (media as any).addListener(onMediaChange);
    }

    return () => {
      if (media.removeEventListener) {
        media.removeEventListener('change', onMediaChange);
      } else if ((media as any).removeListener) {
        (media as any).removeListener(onMediaChange);
      }
    };
  }, []);

  const handleChange = (newPref: ThemePref) => {
    setPreference(newPref);
    currentPreference.current = newPref;
    try {
      localStorage.setItem('deviceops-theme', newPref);
    } catch {}
    const active = applyTheme(newPref);
    setResolved(active);
  };

  const Icon = preference === 'system' ? Monitor : resolved === 'dark' ? Moon : Sun;

  return (
    <label className="theme-control" title={`Theme: ${preference} (active: ${resolved})`}>
      <Icon size={16} aria-hidden="true" />
      <span className="ops-sr-only">Color theme</span>
      <select
        aria-label="Color theme"
        value={preference}
        onChange={(e) => handleChange(e.target.value as ThemePref)}
      >
        <option value="system">System ({systemIsDark ? 'Dark' : 'Light'})</option>
        <option value="light">Light</option>
        <option value="dark">Dark</option>
      </select>
    </label>
  );
}
