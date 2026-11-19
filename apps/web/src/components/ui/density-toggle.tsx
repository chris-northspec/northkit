'use client';

import { useEffect, useState } from 'react';

// The table density toggle (standard 13): compact rows are 44 px, comfortable 52 px. The
// choice is remembered on this device only, and applied to the table card it sits in.
const KEY = 'northkit.density';
type Density = 'comfortable' | 'compact';

export function DensityToggle({ targetId }: { targetId: string }) {
  const [density, setDensity] = useState<Density>('comfortable');
  useEffect(() => {
    try {
      const saved = localStorage.getItem(KEY);
      if (saved === 'compact' || saved === 'comfortable') setDensity(saved);
    } catch {
      // Private window or blocked storage: comfortable it stays.
    }
  }, []);
  useEffect(() => {
    document.getElementById(targetId)?.setAttribute('data-density', density);
  }, [density, targetId]);
  const choose = (next: Density) => {
    setDensity(next);
    try {
      localStorage.setItem(KEY, next);
    } catch {
      // Not remembered; fine.
    }
  };
  return (
    <div className="density-toggle" role="group" aria-label="Row height">
      {(['comfortable', 'compact'] as const).map((d) => (
        <button key={d} type="button" aria-pressed={density === d} onClick={() => choose(d)}>
          {d === 'comfortable' ? 'Comfortable' : 'Compact'}
        </button>
      ))}
    </div>
  );
}
