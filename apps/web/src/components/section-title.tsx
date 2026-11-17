'use client';

import { usePathname } from 'next/navigation';

export interface Section {
  href: string;
  label: string;
}

/** The menu item a path belongs to: the longest href that is the path or a parent of it. */
export function sectionFor(path: string, sections: Section[]): Section | undefined {
  let best: Section | undefined;
  for (const s of sections) {
    const match = s.href === '/' ? path === '/' : path === s.href || path.startsWith(`${s.href}/`);
    if (match && (!best || s.href.length > best.href.length)) best = s;
  }
  return best;
}

/**
 * The top bar's left side on a wide screen: the section you're in, as the menu names it.
 * Plain text, not a heading: each page has its own h1.
 */
export function SectionTitle({ sections }: { sections: Section[] }) {
  const section = sectionFor(usePathname(), sections);
  return <p className="topbar-title">{section?.label ?? ''}</p>;
}
