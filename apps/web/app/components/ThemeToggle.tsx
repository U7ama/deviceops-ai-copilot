'use client';
import { NativeSelect } from '@/components/ui/native-select';

import { Sun, Moon, Monitor } from 'lucide-react';
import { useTheme, type ThemePreference } from './ThemeProvider';

export function ThemeToggle() {
  const { preference, resolved, setPreference } = useTheme();
  const Icon = preference === 'system' ? Monitor : resolved === 'dark' ? Moon : Sun;
  return <label className="theme-control" title={`Theme: ${preference} (active: ${resolved})`}>
    <Icon size={15} aria-hidden="true" /><span className="sr-only">Color theme</span>
    <NativeSelect aria-label="Color theme" value={preference} onChange={event => setPreference(event.target.value as ThemePreference)}>
      <option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option>
    </NativeSelect>
  </label>;
}
