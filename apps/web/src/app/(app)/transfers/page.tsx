import type { Metadata } from 'next';
import { ArrowLeftRight, Inbox, Send } from 'lucide-react';
import { can, listTransfers, movementChoices, type TransferRow } from '@northkit/core';
import { ActionForm, SelectField } from '@/components/form/action-form';
import { EmptyState } from '@/components/states';
import { CardHead, Delta } from '@/components/ui/primitives';
import { KindChip } from '@/components/ui/kind-icon';
import { ScanToOpen } from '@/components/move/scan-to-open';
import { n, plural, ukDay } from '@/lib/format';
import { db } from '@/lib/server/db';
import { requirePermission } from '@/lib/server/session';
import { cancelTransferAction, receiveTransferAction } from './actions';

export const metadata: Metadata = { title: 'Transfers' };

/**
 * Transfers between depots (S3-3, A18): what is coming in to your depots, which you receive
 * by scanning its label (or from here), and what is going out. A transfer not received by
 * its expected date shows as late for both depots.
 */
export default async function TransfersPage() {
  const session = await requirePermission('checkouts.view');
  const canAct = can(session.actor, 'checkouts.edit');
  const [rows, choices] = await Promise.all([
    listTransfers(db(), session.actor),
    canAct ? movementChoices(db(), session.actor) : Promise.resolve(null),
  ]);
  const incoming = rows.filter((t) => t.incoming);
  const outgoing = rows.filter((t) => !t.incoming);
  const late = rows.filter((t) => t.overdue).length;
  const places = (siteId: string) =>
    (choices?.places ?? [])
      .filter((p) => p.siteId === siteId)
      .map((p) => ({ value: p.id, label: `${p.name} (${p.code})` }));

  return (
    <>
      <div className="page-head">
        <div className="page-head-text">
          <p className="page-head-meta">Movements</p>
          <h1>Transfers</h1>
        </div>
      </div>

      <ul className="summary-strip" aria-label="Summary">
        <li>
          <span className="eyebrow">Coming in</span>
          <span className="figure">{n(incoming.length)}</span>
        </li>
        <li>
          <span className="eyebrow">Going out</span>
          <span className="figure">{n(outgoing.length)}</span>
        </li>
        <li>
          <span className="eyebrow">Late</span>
          <span className="figure">{n(late)}</span>
        </li>
      </ul>

      {canAct ? <ScanToOpen label="Scan a label to receive it" /> : null}

      {rows.length === 0 ? (
        <EmptyState title="Nothing is on the road" picture="all-clear">
          <p>
            To send kit to another depot, open the item and choose “Send to another depot”. It
            appears here until the other depot receives it.
          </p>
        </EmptyState>
      ) : null}

      {incoming.length ? (
        <section aria-labelledby="in-h" className="stack">
          <CardHead
            icon={Inbox}
            headingId="in-h"
            title="Coming in"
            meta="Receive each one when it arrives."
          />
          {incoming.map((t) => (
            <TransferCard key={t.id} t={t}>
              {canAct ? (
                <ActionForm
                  action={receiveTransferAction.bind(null, t.id)}
                  submitLabel="Receive it here"
                >
                  <SelectField name="locationId" label="Put it in" options={places(t.toSiteId)} />
                  <div className="field">
                    <label htmlFor={`rn-${t.id}`}>Note</label>
                    <input id={`rn-${t.id}`} name="note" className="input" maxLength={1000} />
                  </div>
                </ActionForm>
              ) : null}
            </TransferCard>
          ))}
        </section>
      ) : null}

      {outgoing.length ? (
        <section aria-labelledby="out-h" className="stack">
          <CardHead
            icon={Send}
            headingId="out-h"
            title="Going out"
            meta="Sent from your depots, not yet received."
          />
          {outgoing.map((t) => (
            <TransferCard key={t.id} t={t}>
              {canAct ? (
                <ActionForm
                  action={cancelTransferAction.bind(null, t.id)}
                  submitLabel="Take it back"
                  submitClassName="button"
                >
                  <SelectField
                    name="locationId"
                    label="Put it back in"
                    options={places(t.fromSiteId)}
                  />
                </ActionForm>
              ) : null}
            </TransferCard>
          ))}
        </section>
      ) : null}
    </>
  );
}

function TransferCard({ t, children }: { t: TransferRow; children?: React.ReactNode }) {
  return (
    <article
      id={`transfer-${t.id}`}
      className={`card${t.overdue ? ' edge-warning' : ''}`}
      aria-label={`Transfer of ${t.assetNumber}`}
    >
      <div className="card-head">
        <KindChip kindName={t.kindName} />
        <div className="card-head-text">
          <h3 className="card-title">{t.assetNumber}</h3>
          <p className="card-meta">
            {t.kindName}
            {t.parts ? ` · with ${plural(t.parts, 'item')}` : ''}
          </p>
        </div>
        <div className="card-action">
          {t.overdue ? <Delta tone="attention">Late</Delta> : <Delta>In transit</Delta>}
        </div>
      </div>
      <p>
        {t.fromSiteCode} <ArrowLeftRight size={14} className="icon" aria-label="to" />{' '}
        {t.toSiteCode} · {t.carrier} · expected <strong>{ukDay(t.expectedOn)}</strong>
        {t.note ? <span className="muted"> · “{t.note}”</span> : null}
      </p>
      {children}
    </article>
  );
}
