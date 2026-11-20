'use client';

import { useEffect } from 'react';

/**
 * Marks the document once React has hydrated it (data-hydrated on <html>). The browser
 * tests wait for this before typing into a form, instead of waiting for the network to go
 * quiet: under the development server (the demo link's tests) the network never does, so
 * `networkidle` waits time out or, worse, return early and a click submits a form that
 * React hasn't taken over yet. Nothing else reads it.
 */
export function Hydrated() {
  useEffect(() => {
    document.documentElement.dataset.hydrated = 'true';
  }, []);
  return null;
}
