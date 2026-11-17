import type { Metadata } from 'next';
import Link from 'next/link';
import { reportingLogin } from '@northkit/core';
import { db } from '@/lib/server/db';
import { requirePermission } from '@/lib/server/session';

export const metadata: Metadata = { title: 'Reporting login' };

/**
 * The reporting login for Power BI or Excel (S7-3, DR-4): whether it is on, what it reads,
 * and how to turn it on. Its password lives in deploy/.env only and is never shown here.
 */
export default async function ReportingLoginPage() {
  const session = await requirePermission('settings.view');
  const login = await reportingLogin(db(), session.actor);
  return (
    <>
      <p className="breadcrumbs">
        <Link href="/settings">Settings</Link>
      </p>
      <h1>Reporting login for Power BI or Excel</h1>
      <p>
        Your reporting tools can read NorthKit’s figures directly from the database with a read-only
        login, <span className="mono">{login.role}</span>. It can read the reporting views listed
        below and nothing else: it can’t change anything, can’t see passwords or sign-in records,
        and doesn’t go through the app’s site permissions, so it sees <strong>every site</strong>.
        Give it to your own reporting staff only.
      </p>
      <p
        className={`notice ${login.enabled ? 'notice-info' : 'notice-warning'}`}
        data-reporting-login={login.enabled ? 'on' : 'off'}
      >
        <strong>{login.enabled ? 'On' : 'Off'}:</strong>{' '}
        {login.enabled
          ? 'the reporting login has a password and can sign in.'
          : 'the reporting login has no password, so nothing can sign in with it.'}
      </p>

      <section className="panel" aria-labelledby="setup-heading">
        <h2 id="setup-heading">Turn it on, change its password, or turn it off</h2>
        <p>
          On the NorthKit server, set its password in <span className="mono">deploy/.env</span> and
          apply it. Leave the password blank to turn the login off. The password is never shown or
          stored in NorthKit itself.
        </p>
        <pre className="code-block">
          {`NORTHKIT_READONLY_DB_PASSWORD=<a long random password>

docker compose -f deploy/docker-compose.yml run --rm migrate`}
        </pre>
        <p>
          The database listens on this server only (port 5450). Connect from another computer
          through an SSH tunnel, as the Power BI and Excel guide in NorthKit’s documentation (
          <span className="mono">docs/admin/reporting.md</span>) explains.
        </p>
      </section>

      <section className="panel" aria-labelledby="views-heading">
        <h2 id="views-heading">What it can read</h2>
        <p>
          Each view is described column by column in the data dictionary (
          <span className="mono">docs/data-dictionary</span>).
        </p>
        <div className="table-wrap" role="region" aria-labelledby="views-heading" tabIndex={0}>
          <table className="table table-cards">
            <thead>
              <tr>
                <th scope="col">View</th>
                <th scope="col">What it holds</th>
              </tr>
            </thead>
            <tbody>
              {login.views.map((v) => (
                <tr key={v.name}>
                  <td data-label="View" className="mono">
                    reporting.{v.name}
                  </td>
                  <td data-label="What it holds">{v.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
