import type { Metadata } from 'next';
import Link from 'next/link';
import { can, getItemImport } from '@northkit/core';
import { ActionForm } from '@/components/form/action-form';
import { StatusPill, type PillTone } from '@/components/badges';
import { db } from '@/lib/server/db';
import { orNotFound, routeId } from '@/lib/server/load';
import { requirePermission } from '@/lib/server/session';
import { storeImportAction } from '../actions';
import { IMPORT_STATUS } from '../page';

export const metadata: Metadata = { title: 'Import' };

export default async function ImportDetailPage({
  params,
}: {
  params: Promise<{ importId: string }>;
}) {
  const session = await requirePermission('imports.view');
  const importId = routeId((await params).importId);
  const imp = await orNotFound(getItemImport(db(), session.actor, importId));
  const s = IMPORT_STATUS[imp.status] ?? { label: imp.status, tone: 'neutral' as PillTone };
  const { parsed } = imp;
  const waiting = imp.status === 'queued' || imp.status === 'checking' || imp.status === 'loading';
  const canStore = can(session.actor, 'imports.create') && imp.status === 'ready';

  return (
    <>
      <p className="breadcrumbs">
        <Link href="/import">Import items</Link>
      </p>
      {/* While the worker has the file, the page asks again every few seconds. */}
      {waiting ? <meta httpEquiv="refresh" content="5" /> : null}
      <div className="page-head">
        <div className="page-head-text">
          <p className="page-head-meta">Import</p>
          <h1>{imp.file_name}</h1>
          <p>
            <StatusPill label={s.label} tone={s.tone} />
          </p>
        </div>
      </div>

      {waiting ? (
        <p className="notice notice-info" role="status">
          {imp.status === 'loading' ? 'Storing the items' : 'Checking the file'}: this page
          refreshes by itself.
        </p>
      ) : null}

      {imp.status === 'loaded' ? (
        <p className="notice notice-success" role="status">
          <strong>{imp.items_loaded.toLocaleString('en-GB')} items stored.</strong>{' '}
          <Link href="/items">See the register</Link>.
        </p>
      ) : null}

      {imp.status === 'failed' ? (
        <p className="notice notice-critical" role="alert">
          The import failed: {imp.error ?? 'something went wrong'}. Nothing was stored. Try again,
          and tell your administrator if it keeps happening.
        </p>
      ) : null}

      {imp.status === 'ready' ? (
        <section className="panel" aria-labelledby="ready-heading">
          <h2 id="ready-heading">No problems found</h2>
          <p>
            All {parsed.rowCount.toLocaleString('en-GB')} rows are fine. Nothing has been stored
            yet.
          </p>
          {canStore ? (
            <ActionForm
              action={storeImportAction.bind(null, imp.id)}
              submitLabel={`Store ${parsed.rowCount.toLocaleString('en-GB')} items`}
              pendingLabel="Storing…"
            />
          ) : null}
        </section>
      ) : null}

      {parsed.fileProblems.length > 0 || parsed.problems.length > 0 ? (
        <section className="panel" aria-labelledby="problems-heading">
          <h2 id="problems-heading">
            {parsed.fileProblems.length + parsed.problems.length}{' '}
            {parsed.fileProblems.length + parsed.problems.length === 1 ? 'problem' : 'problems'}{' '}
            found
          </h2>
          <p>
            <strong>Nothing was stored.</strong> Fix these in your spreadsheet and upload it again.
            Line numbers match the rows in your file, where the header is line 1.
          </p>
          {parsed.fileProblems.length > 0 ? (
            <ul className="stack">
              {parsed.fileProblems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          ) : null}
          {parsed.problems.length > 0 ? (
            <div className="table-wrap" role="region" aria-label="Problems" tabIndex={0}>
              <table className="table table-cards">
                <thead>
                  <tr>
                    <th scope="col" className="num">
                      Line
                    </th>
                    <th scope="col">Column</th>
                    <th scope="col">Problem</th>
                  </tr>
                </thead>
                <tbody>
                  {parsed.problems.slice(0, 500).map((p, i) => (
                    <tr key={`${p.line}-${p.column}-${i}`}>
                      <td data-label="Line" className="num">
                        {p.line}
                      </td>
                      <td data-label="Column">{p.column}</td>
                      <td data-label="Problem">{p.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          {parsed.problems.length > 500 ? (
            <p className="muted">Showing the first 500. Download the list to see them all.</p>
          ) : null}
          <p>
            <a className="button" href={`/import/${imp.id}/problems`}>
              Download the problems as CSV
            </a>
          </p>
        </section>
      ) : null}
    </>
  );
}
