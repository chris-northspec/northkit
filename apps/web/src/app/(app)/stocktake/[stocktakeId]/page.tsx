import type { Metadata } from 'next';
import Link from 'next/link';
import { CheckCheck, CircleHelp, PackageX } from 'lucide-react';
import { can, stocktakeResult, type StocktakeLineView } from '@northkit/core';
import { ActionForm } from '@/components/form/action-form';
import { ItemStatusPill } from '@/components/badges';
import { CardHead, Delta } from '@/components/ui/primitives';
import { KindChip } from '@/components/ui/kind-icon';
import { n, plural, ukMoment } from '@/lib/format';
import { db } from '@/lib/server/db';
import { orNotFound, routeId } from '@/lib/server/load';
import { requirePermission } from '@/lib/server/session';
import { closeStocktakeAction } from '../actions';

export const metadata: Metadata = { title: 'Stocktake result' };

const DECISION_WORDS: Record<string, string> = {
  missing: 'Marked missing',
  ignored: 'Ignored',
  moved_here: 'Moved here',
  note_only: 'Noted only',
};

/**
 * The stocktake result (S3-5): expected and found; expected but not found, each marked
 * "Missing" or "Ignore with a reason"; found but not expected, each "Move here" or "Note
 * only". Closing records the result and applies only the choices made.
 */
export default async function StocktakeResultPage({
  params,
}: {
  params: Promise<{ stocktakeId: string }>;
}) {
  const session = await requirePermission('checkouts.view');
  const id = routeId((await params).stocktakeId);
  const r = await orNotFound(stocktakeResult(db(), session.actor, id));
  const st = r.stocktake;
  const open = st.status === 'counting';
  const canClose = open && can(session.actor, 'checkouts.edit');
  const canScan = open && can(session.actor, 'checkouts.create');

  const body = (
    <>
      <section className="card" aria-labelledby="found-h">
        <CardHead
          icon={CheckCheck}
          headingId="found-h"
          eyebrow="Expected and found"
          title={plural(r.found.length, 'item')}
          meta="The register and the shelf agree."
        />
        {r.found.length ? (
          <ul className="chip-list">
            {r.found.map((l) => (
              <li key={l.itemId}>
                <Link className="chip" href={`/items/${l.itemId}`}>
                  {l.assetNumber}
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">Nothing expected here has been scanned yet.</p>
        )}
      </section>

      <section className="card" aria-labelledby="nf-h">
        <CardHead
          icon={PackageX}
          headingId="nf-h"
          eyebrow="Expected but not found"
          title={plural(r.notFound.length, 'item')}
          meta="The register has these here, but they weren’t scanned. Mark each missing, or ignore it and say why."
        />
        {r.notFound.length === 0 ? (
          <p className="muted">Everything expected here was found.</p>
        ) : null}
        <ul className="stack">
          {r.notFound.map((l) => (
            <Line
              key={l.itemId}
              line={l}
              open={open}
              choices={[
                ['missing', 'Missing'],
                ['ignored', 'Ignore with a reason'],
              ]}
              reasonFor="ignored"
            />
          ))}
        </ul>
      </section>

      <section className="card" aria-labelledby="un-h">
        <CardHead
          icon={CircleHelp}
          headingId="un-h"
          eyebrow="Found but not expected"
          title={plural(r.unexpected.length, 'item')}
          meta="Scanned here, but the register has them somewhere else. Move each here, or just note it."
        />
        {r.unexpected.length === 0 ? (
          <p className="muted">Nothing turned up that wasn’t expected.</p>
        ) : null}
        <ul className="stack">
          {r.unexpected.map((l) => (
            <Line
              key={l.itemId}
              line={l}
              open={open}
              choices={
                l.canMove
                  ? [
                      ['moved_here', 'Move here'],
                      ['note_only', 'Note only'],
                    ]
                  : [['note_only', 'Note only']]
              }
            />
          ))}
        </ul>
      </section>
    </>
  );

  return (
    <>
      <p className="breadcrumbs">
        <Link href="/stocktake">Stocktake</Link>
      </p>
      <div className="page-head">
        <div className="page-head-text">
          <p className="page-head-meta">
            {st.siteCode} ·{' '}
            {open
              ? `started ${ukMoment(st.startedAt)}`
              : `closed ${st.closedAt ? ukMoment(st.closedAt) : ''}`}
          </p>
          <h1>{st.locationName}</h1>
        </div>
        <div className="page-head-actions">
          {open ? <Delta tone="attention">Counting</Delta> : <Delta tone="good">Closed</Delta>}
          {canScan ? (
            <Link className="button" href={`/stocktake/count?id=${st.id}&loc=${st.locationId}`}>
              Keep scanning
            </Link>
          ) : null}
        </div>
      </div>
      <ul className="summary-strip" aria-label="Summary">
        <li>
          <span className="eyebrow">Expected</span>
          <span className="figure">{n(r.found.length + r.notFound.length)}</span>
        </li>
        <li>
          <span className="eyebrow">Found</span>
          <span className="figure">{n(r.found.length)}</span>
        </li>
        <li>
          <span className="eyebrow">Not found</span>
          <span className="figure">{n(r.notFound.length)}</span>
        </li>
        <li>
          <span className="eyebrow">Not expected</span>
          <span className="figure">{n(r.unexpected.length)}</span>
        </li>
      </ul>

      {canClose ? (
        <ActionForm
          action={closeStocktakeAction.bind(null, st.id)}
          submitLabel="Close the stocktake and apply these choices"
          pendingLabel="Closing…"
          className="stack"
        >
          {body}
          <div className="field">
            <label htmlFor="note">Note (optional)</label>
            <input id="note" name="note" className="input" maxLength={1000} />
          </div>
          <p className="muted small">
            Closing records this result and applies only the choices you made: items marked missing
            are reported missing, and items you chose to move here are moved. Nothing else changes.
          </p>
        </ActionForm>
      ) : (
        <div className="stack">
          {body}
          {open ? (
            <p className="muted">
              A Supervisor or Kit Manager closes the count and applies the choices.
            </p>
          ) : null}
        </div>
      )}
    </>
  );
}

function Line({
  line,
  open,
  choices,
  reasonFor,
}: {
  line: StocktakeLineView;
  open: boolean;
  choices: [string, string][];
  reasonFor?: string;
}) {
  const name = `decision-${line.itemId}`;
  return (
    <li className="scan-item scan-item-stack">
      <div className="row">
        <KindChip kindName={line.kindName} />
        <span className="grow">
          <Link href={`/items/${line.itemId}`}>
            <strong>{line.assetNumber}</strong>
          </Link>{' '}
          <span className="muted small">
            {line.kindName}
            {line.elsewhere ? ` · the register has it in ${line.elsewhere}` : ''}
          </span>
        </span>
        <ItemStatusPill status={line.status} />
      </div>
      {open ? (
        <fieldset className="choice-set">
          <legend className="visually-hidden">What to do about {line.assetNumber}</legend>
          {choices.map(([value, label]) => (
            <label key={value} className="choice">
              <input type="radio" name={name} value={value} />
              {label}
            </label>
          ))}
          {reasonFor ? (
            <div className="field">
              <label htmlFor={`reason-${line.itemId}`}>
                Why ignore {line.assetNumber}? (if you choose Ignore)
              </label>
              <input
                id={`reason-${line.itemId}`}
                name={`reason-${line.itemId}`}
                className="input"
                maxLength={500}
              />
            </div>
          ) : null}
          {line.cannotMoveWhy ? <p className="muted small">{line.cannotMoveWhy}</p> : null}
        </fieldset>
      ) : line.decision ? (
        <p>
          <strong>{DECISION_WORDS[line.decision]}</strong>
          {line.reason ? `: ${line.reason}` : ''}
        </p>
      ) : null}
    </li>
  );
}
