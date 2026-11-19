'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

/**
 * A sidebar link that marks itself as the current page (aria-current) for its section.
 * The label stays in the page when the sidebar collapses to icons, so screen readers still
 * hear it.
 */
export function NavLink({
  href,
  icon,
  children,
}: {
  href: string;
  icon?: ReactNode;
  children: ReactNode;
}) {
  const path = usePathname();
  const current = href === '/' ? path === '/' : path === href || path.startsWith(`${href}/`);
  return (
    <Link href={href} aria-current={current ? 'page' : undefined}>
      {icon}
      <span className="nav-label">{children}</span>
    </Link>
  );
}
