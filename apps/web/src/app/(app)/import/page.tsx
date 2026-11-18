import type { Metadata } from 'next';
import Link from 'next/link';
import { can, ITEM_IMPORT_COLUMNS, listItemImports, MAX_IMPORT_ROWS } from '@northkit/core';
import { ActionForm } from '@/components/form/action-form';
import { StatusPill, type PillTone } from '@/components/badges';
import { EmptyState } from '@/components/states';
import { db } from '@/lib/server/db';
import { requirePermission } from '@/lib/server/session';
import { uploadImportAction } from './actions';

export const metadata: Metadata = { title: 'Import items' };

const ukDateTime = new Intl.DateTimeFormat('en-GB', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Europe/London',
});

export const IMPORT_STATUS: Record<string, { label: string; tone: PillTone }> = {
  queued: { label: 'Waiting to be checked', tone: 'info' },
  checking: { label: 'Checking', tone: 'info' },
  problems: { label: 'Problems found', tone: 'danger' },
  ready: { label: 'Ready to store', tone: 'success' },
  loading: { label: 'Storing', tone: 'info' },
  loaded: { label: 'Stored', tone: 'success' },
  failed: { label: 'Failed', tone: 'danger' },
};

export default async function ImportPage() {
  const session = await requirePermission('imports.view');
  const imports = await listItemImports(db(), session.actor);
  const canImport = can(session.actor, 'imports.create') && can(session.actor, 'items.create');
  return (
    <>
      <div className="page-head">
        <div className="page-head-text">
          <p className="page-head-meta">Register</p>
          <h1>Import items</h1>
        </div>
      </div>
      <p>
        Bring items in from a spreadsheet (CSV or Excel). Every problem is listed by row and column
        before anything is stored, and the import is all or nothing: if one row is wrong, no item is
        added. Formulas are never run.
      </p>

      <section className="panel" aria-labelledby="template-heading">
        <h2 id="template-heading">Start from the template</h2>
        <p>
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- a file download, not a page */}
          <a className="button" href="/import/template?format=xlsx">
            Excel template
          </a>{' '}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- a file download, not a page */}
          <a className="button" href="/import/template?format=csv">
            CSV template
          </a>
        </p>
        <p className="muted">
          Columns: {ITEM_IMPORT_COLUMNS.join(', ')}. Only <strong>kind</strong> and{' '}
          <strong>depot</strong> are needed. A kind must already exist (see{' '}
          <Link href="/kinds">Kinds</Link>); a depot is matched by its code or name. Leave the asset
          number blank to generate one. To make a kit, put “yes” in <code>is_kit</code>, then give
          its parts the kit’s asset number in <code>parent_asset_number</code>. Up to{' '}
          {MAX_IMPORT_ROWS.toLocaleString('en-GB')} rows and 5 MB at a time.
        </p>
      </section>

      {canImport ? (
        <section className="panel" aria-labelledby="upload-heading">
          <h2 id="upload-heading">Upload a file</h2>
          <ActionForm
            action={uploadImportAction}
            submitLabel="Check the file"
            pendingLabel="Checking…"
          >
            <div className="field">
              <label htmlFor="file">CSV or Excel (.xlsx) file</label>
              <input
                id="file"
                name="file"
                type="file"
                accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                required
              />
              <p className="hint">
                Macro workbooks (.xlsm) and older Excel files (.xls) are not read: save the sheet as
                .xlsx or .csv.
              </p>
            </div>
          </ActionForm>
        </section>
      ) : null}

      <section aria-labelledby="past-heading">
        <h2 id="past-heading">Imports</h2>
        {imports.length === 0 ? (
          <EmptyState title="No imports yet" picture="empty-items" />
        ) : (
          <div className="table-wrap" role="region" aria-label="Imports" tabIndex={0}>
            <table className="table table-cards">
              <thead>
                <tr>
                  <th scope="col">File</th>
                  <th scope="col">When</th>
                  <th scope="col" className="num">
                    Rows
                  </th>
                  <th scope="col" className="num">
                    Items stored
                  </th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {imports.map((i) => {
                  const s = IMPORT_STATUS[i.status] ?? {
                    label: i.status,
                    tone: 'neutral' as PillTone,
                  };
                  return (
                    <tr key={i.id}>
                      <td data-label="File">
                        <Link href={`/import/${i.id}`}>{i.file_name}</Link>
                      </td>
                      <td data-label="When">{ukDateTime.format(i.created_at)}</td>
                      <td data-label="Rows" className="num">
                        {i.row_count.toLocaleString('en-GB')}
                      </td>
                      <td data-label="Items stored" className="num">
                        {i.items_loaded.toLocaleString('en-GB')}
                      </td>
                      <td data-label="Status">
                        <StatusPill label={s.label} tone={s.tone} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
