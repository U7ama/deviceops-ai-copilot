'use client';
import { NativeSelect } from '@/components/ui/native-select';

import { Palette as PaletteIcon } from 'lucide-react';
import { palettes, useTheme, type Palette } from './ThemeProvider';

export function PaletteSelector() {
  const { palette, setPalette } = useTheme();
  return <label className="palette-control" title="Dashboard palette">
    <PaletteIcon size={15} aria-hidden="true" />
    <span className="sr-only">Dashboard palette</span>
    <NativeSelect aria-label="Dashboard palette" value={palette} onChange={event => setPalette(event.target.value as Palette)}>
      {palettes.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
    </NativeSelect>
  </label>;
}
