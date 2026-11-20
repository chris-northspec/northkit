import type { Metadata } from 'next';
import Link from 'next/link';
import { ClipboardList, Hand, LogIn, LogOut, PackageSearch } from 'lucide-react';
import { requirePermission } from '@/lib/server/session';

export const metadata: Metadata = { title: 'Check out and in' };

/** The phone front door for moving kit: what an operative does most, as big targets. */
export default async function MoveHub() {
  await requirePermission('checkouts.create');
  const tiles = [
    { href: '/move/out', label: 'Check out', icon: LogOut },
    { href: '/move/in', label: 'Check in', icon: LogIn },
    { href: '/move/missing', label: 'Report missing', icon: PackageSearch },
    { href: '/stocktake', label: 'Stocktake', icon: ClipboardList },
    { href: '/my-kit', label: 'My kit', icon: Hand },
  ];
  return (
    <div className="scan">
      <div className="scan-head">
        <div>
          <h1>Check out and in</h1>
          <p>Scan a label, or type an asset number.</p>
        </div>
      </div>
      <ul className="scan-choices">
        {tiles.map(({ href, label, icon: Icon }) => (
          <li key={href}>
            <Link className="scan-btn" href={href}>
              <Icon size={22} className="icon" aria-hidden="true" />
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
