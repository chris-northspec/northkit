'use client';

import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';
import { CameraScanner } from './scanner';
import { codeFrom } from '@/lib/offline/snapshot';

/**
 * Scan a label (or paste its address) to open the item it names: used to receive a transfer,
 * since a depot can't see the item until it has arrived. The server decides what the code
 * means and shows the receive form only to a depot the transfer is coming to.
 */
export function ScanToOpen({ label }: { label: string }) {
  const router = useRouter();
  const id = useId();
  const [text, setText] = useState('');
  const go = (scanned: string) => {
    const code = codeFrom(scanned);
    if (code) router.push(`/i/${encodeURIComponent(code)}`);
  };
  return (
    <section className="card stack" aria-label={label}>
      <CameraScanner onCode={go} label={label} />
      <div className="field">
        <label htmlFor={id}>Or paste the label’s address</label>
        <input
          id={id}
          className="input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              go(text);
            }
          }}
        />
      </div>
    </section>
  );
}
