'use client';

import { useEffect, useRef, useState } from 'react';

// Keys that move a closed select's value one step at a time in Chrome and Edge.
const STEP_KEYS = new Set(['ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown']);

/**
 * The site filter's Show button. With JavaScript, choosing a site applies at once and
 * Show is visually hidden (it reappears when focused). Without JavaScript it is a plain
 * submit button.
 *
 * A change made with the keyboard on the closed select does not apply by itself:
 * those browsers fire "change" on every arrow press, so applying it would reload the
 * page at each step (WCAG 3.2.2). Tab to Show instead.
 */
export function SiteFilterShow() {
  const ref = useRef<HTMLButtonElement>(null);
  const [applies, setApplies] = useState(false);
  useEffect(() => {
    const form = ref.current?.form;
    const select = form?.querySelector('select');
    if (!form || !select) return;
    let byKeyboard = false;
    const onKey = (e: KeyboardEvent) => {
      if (STEP_KEYS.has(e.key) || e.key.length === 1) byKeyboard = true;
    };
    const onPointer = () => {
      byKeyboard = false;
    };
    const onChange = () => {
      if (!byKeyboard) form.requestSubmit();
    };
    select.addEventListener('keydown', onKey);
    select.addEventListener('pointerdown', onPointer);
    select.addEventListener('change', onChange);
    setApplies(true);
    return () => {
      select.removeEventListener('keydown', onKey);
      select.removeEventListener('pointerdown', onPointer);
      select.removeEventListener('change', onChange);
    };
  }, []);
  return (
    <button
      ref={ref}
      type="submit"
      className={applies ? 'button site-filter-show-applies' : 'button'}
    >
      Show
    </button>
  );
}
