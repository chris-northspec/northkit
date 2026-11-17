'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

/** A sidebar link that marks itself as the current page (aria-current) for its section. */
export function NavLink({ href, children }: { href: string; children: ReactNode }) {
  const path = usePathname();
  const current = href === '/' ? path === '/' : path === href || path.startsWith(`${href}/`);
  return (
    <Link href={href} aria-current={current ? 'page' : undefined}>
      {children}
    </Link>
  );
}
