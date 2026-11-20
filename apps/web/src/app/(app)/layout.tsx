import Link from 'next/link';
import { headers } from 'next/headers';
import {
  ArrowLeftRight,
  Boxes,
  ClipboardList,
  FileUp,
  Hand,
  LayoutDashboard,
  LogIn,
  LogOut,
  MapPin,
  ScrollText,
  Settings,
  ShieldCheck,
  Tag,
  UserRound,
  Users,
  type LucideIcon,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { can, isDemoHost, organisationName, type Permission } from '@northkit/core';
import { MenuButton, MenuPanel, SkipToMenu } from '@/components/menu';
import { OfflineSync } from '@/components/offline/offline-sync';
import { OfflineUser } from '@/components/offline/offline-user';
import { NavLink } from '@/components/nav-link';
import { ProductMark } from '@/components/product-mark';
import { SectionTitle } from '@/components/section-title';
import { SignOutButton } from '@/components/sign-out-button';
import { SiteFilterShow } from '@/components/site-filter-show';
import { db } from '@/lib/server/db';
import { currentSession, siteSelection, type SiteSelection } from '@/lib/server/session';
import { chooseSiteAction } from './site-actions';

// The app shell (S1-10, B-1, B-2; house style S7-11, as NorthSlot and NorthCore): the Ink
// sidebar on the left (mark and name, the menu, the signed-in person and Sign out), one
// slim top bar (the section; site filter, search, notifications, Report a problem), then
// the page. Below 1024 px the menu opens as a panel from the left. Source order: two skip
// links, the demo strip (demo link only), menu, top bar, page. Every page under (app) checks the session itself; this
// layout only lays out what the user may see.

// `needs`: one permission, or a list of which any one will do.
interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  needs?: Permission | Permission[];
}
const NAV: { heading?: string; items: NavItem[] }[] = [
  {
    items: [{ href: '/', label: 'Overview', icon: LayoutDashboard }],
  },
  {
    heading: 'Kit',
    items: [
      { href: '/items', label: 'Items', icon: Boxes, needs: 'items.view' },
      { href: '/kinds', label: 'Kinds', icon: Tag, needs: 'items.view' },
      { href: '/who-has-what', label: 'Who has what', icon: Users, needs: 'checkouts.view' },
      { href: '/my-kit', label: 'My kit', icon: Hand, needs: 'checkouts.view' },
    ],
  },
  {
    heading: 'Movements',
    items: [
      { href: '/move/out', label: 'Check out', icon: LogOut, needs: 'checkouts.create' },
      { href: '/move/in', label: 'Check in', icon: LogIn, needs: 'checkouts.create' },
      { href: '/transfers', label: 'Transfers', icon: ArrowLeftRight, needs: 'checkouts.view' },
      { href: '/stocktake', label: 'Stocktake', icon: ClipboardList, needs: 'checkouts.view' },
    ],
  },
  {
    heading: 'Set up',
    items: [
      { href: '/import', label: 'Import items', icon: FileUp, needs: 'imports.view' },
      { href: '/sites', label: 'Depots and locations', icon: MapPin, needs: 'overview.view' },
    ],
  },
  {
    heading: 'Admin',
    items: [
      { href: '/users', label: 'Users', icon: UserRound, needs: 'users.view' },
      { href: '/roles', label: 'Roles and access', icon: ShieldCheck, needs: 'users.view' },
      { href: '/audit', label: 'Audit log', icon: ScrollText, needs: 'users.view' },
      { href: '/settings', label: 'Settings', icon: Settings, needs: 'settings.view' },
    ],
  },
];

export default async function AppLayout({ children }: { children: ReactNode }) {
  const session = await currentSession();
  // Pages redirect anonymous visitors; the shell just renders nothing around them.
  if (!session) return <>{children}</>;
  const [organisation, selection] = await Promise.all([organisationName(db()), siteSelection()]);
  const restricted = session.user.mustChangePassword || session.user.mfaSetupRequired;
  const licence = session.licence;
  // Only on the demo link (docs/demo-link.md), never on a customer's own install. Next
  // reports its own address as the host in pages and keeps the browser's in
  // x-forwarded-host. Only this cosmetic strip uses it: nothing that grants access does.
  const h = await headers();
  const demo = isDemoHost(h.get('x-forwarded-host') ?? h.get('host'));

  const visible = (needs?: Permission | Permission[]) =>
    !needs || (Array.isArray(needs) ? needs : [needs]).some((p) => can(session.actor, p));
  // Only what the user's roles allow. Hiding is a courtesy: every page and action checks
  // again on the server.
  const groups = NAV.map((group) => ({
    ...group,
    items: group.items.filter((item) => visible(item.needs)),
  })).filter((group) => group.items.length > 0);
  const sections = [
    ...groups.flatMap((g) => g.items.map(({ href, label }) => ({ href, label }))),
    { href: '/move', label: 'Check out and in' },
    { href: '/sync', label: 'Changes not sent yet' },
  ];

  const nav = restricted ? null : (
    <MenuPanel>
      <Link href="/" className="brand brand-sidebar">
        <ProductMark organisation={organisation} />
      </Link>
      <div className="nav-groups">
        {groups.map((group, i) => (
          <div key={i}>
            {group.heading ? <p className="nav-heading">{group.heading}</p> : null}
            <ul className="nav-list">
              {group.items.map((item) => (
                <li key={item.href}>
                  <NavLink
                    href={item.href}
                    icon={<item.icon size={20} className="icon" aria-hidden="true" />}
                  >
                    {item.label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <Person name={session.user.displayName} />
    </MenuPanel>
  );

  return (
    <OfflineUser user={restricted ? null : { id: session.user.id, name: session.user.displayName }}>
      <div className="shell">
        <a className="skip-link" href="#main">
          Skip to content
        </a>
        {nav ? <SkipToMenu /> : null}
        {demo ? (
          <p className="demo-strip" role="note">
            Demo, fictional data
          </p>
        ) : null}
        {nav}
        <header className="topbar">
          {/* Below 1024 px the top bar carries the identity; above, the sidebar does. */}
          <div className="topbar-brand">
            <Link href="/" className="brand">
              <ProductMark organisation={organisation} />
            </Link>
          </div>
          {restricted ? null : <SectionTitle sections={sections} />}
          <div className="topbar-tools">
            {restricted ? null : (
              <>
                <SiteFilter selection={selection} />
              </>
            )}
            {nav ? <MenuButton /> : null}
            {/* Set-up screens (password change, two-factor) have no menu: just Sign out. */}
            {restricted ? <SignOutButton /> : null}
          </div>
        </header>

        <main id="main" className="main" tabIndex={-1}>
          {/* D33: signed-in pages need JavaScript (they load in behind a skeleton). Said
            plainly, rather than leaving a skeleton that never finishes. */}
          <noscript>
            <p className="notice notice-warning" role="alert">
              <strong>NorthKit needs JavaScript turned on in this browser.</strong> Turn it on in
              the browser’s settings, then reload this page.
            </p>
            <style>{'.skeleton, [aria-busy="true"] { display: none !important; }'}</style>
          </noscript>
          {restricted ? null : <OfflineSync userId={session.user.id} />}
          {licence.message ? (
            <p
              className={`notice licence-banner notice-${licence.severity === 'critical' ? 'critical' : licence.severity === 'warning' ? 'warning' : 'info'}`}
              role={licence.readOnly ? 'alert' : 'status'}
            >
              <strong>{licence.readOnly ? 'Read-only. ' : 'Licence. '}</strong>
              {licence.message}{' '}
              {can(session.actor, 'settings.view') ? (
                <Link href="/settings#licence">Licence settings</Link>
              ) : null}
            </p>
          ) : null}
          {children}
        </main>
        <footer className="foot powered-by">Powered by NorthSpec</footer>
      </div>
    </OfflineUser>
  );
}

/** The signed-in person at the foot of the sidebar: their account, and Sign out. */
function Person({ name }: { name: string }) {
  return (
    <div className="sidebar-person">
      <span className="muted">Signed in as</span>
      <Link href="/account">{name}</Link>
      <SignOutButton />
    </div>
  );
}

/**
 * The site filter, on every page: a choice for users with several sites, a fixed
 * label for one. "Show" keeps you on the same page; the choice is remembered. With
 * JavaScript the choice applies as soon as it is made.
 */
function SiteFilter({ selection }: { selection: SiteSelection }) {
  if (selection.sites.length > 1)
    return (
      <form action={chooseSiteAction} id="site-filter" className="site-select">
        <label htmlFor="site-select" className="label">
          Depot
        </label>
        <select
          id="site-select"
          name="siteId"
          // Remount when the choice changes, so the select shows it after "Show".
          key={selection.current?.id ?? 'all'}
          defaultValue={selection.current?.id ?? ''}
          className="input"
        >
          <option value="">{selection.allLabel}</option>
          {selection.sites.map((s) => (
            <option key={s.id} value={s.id}>
              {s.code} · {s.name}
            </option>
          ))}
        </select>
        <SiteFilterShow />
      </form>
    );
  if (selection.current)
    return (
      <p
        className="label site-fixed"
        title={`${selection.current.code} · ${selection.current.name}`}
      >
        <span className="site-fixed-label">Depot: </span>
        {selection.current.code} · {selection.current.name}
      </p>
    );
  return null;
}
