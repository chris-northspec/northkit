import type { Metadata } from 'next';
import Link from 'next/link';
import { ActionForm, SelectField } from '@/components/form/action-form';
import { requireSession, siteSelection } from '@/lib/server/session';
import { homeSiteAction } from './actions';

export const metadata: Metadata = { title: 'Your account' };

export default async function AccountPage() {
  const session = await requireSession();
  const selection = await siteSelection();
  const home = selection.sites.find((s) => s.id === session.user.homeSiteId);
  return (
    <>
      <h1>Your account</h1>
      <dl className="details">
        <dt>Name</dt>
        <dd>{session.user.displayName}</dd>
        <dt>Email</dt>
        <dd>{session.user.email}</dd>
        <dt>Two-factor sign-in</dt>
        <dd>{session.user.mfaEnabled ? 'On' : 'Off'}</dd>
      </dl>
      <ul className="plain stack">
        <li>
          <Link href="/change-password">Change your password</Link>
        </li>
        <li>
          <Link href="/account/two-factor">
            {session.user.mfaEnabled ? 'Manage two-factor sign-in' : 'Set up two-factor sign-in'}
          </Link>
        </li>
      </ul>

      {selection.sites.length > 1 ? (
        <section className="panel space-above" aria-labelledby="home-site-heading">
          <h2 id="home-site-heading">Your depots</h2>
          <p className="muted">
            The depot filter at the top of every page starts here. Choosing another depot there is
            remembered in this browser.
          </p>
          <ActionForm action={homeSiteAction} submitLabel="Save">
            <SelectField
              name="homeSiteId"
              label="Open on"
              options={[
                { value: '', label: selection.allLabel },
                ...selection.sites.map((s) => ({ value: s.id, label: `${s.code} · ${s.name}` })),
              ]}
              defaultValue={home?.id ?? ''}
            />
          </ActionForm>
        </section>
      ) : null}
    </>
  );
}
