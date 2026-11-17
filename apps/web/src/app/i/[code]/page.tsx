import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { can, getItem, resolveItemLabel } from '@northkit/core';
import { ProductMark } from '@/components/product-mark';
import { db } from '@/lib/server/db';
import { currentSession } from '@/lib/server/session';

export const metadata: Metadata = { title: 'Label', robots: { index: false, follow: false } };

/**
 * What a QR label opens (S2-4, LB-2).
 *   - Signed in, with access to the item's depot: the item page.
 *   - Anyone else: ONLY the item's kind and asset number, and "Report a fault: coming
 *     soon" (the form arrives in Sprint 5, with rate limits). Nothing else about the item
 *     is shown, and nothing can be learned by guessing: a changed, forged, shortened or
 *     replaced code, and a code for an item the visitor can't see, all get the page below
 *     with no details at all.
 */
export default async function ScanPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const scan = await resolveItemLabel(db(), code);
  const session = await currentSession();
  if (
    scan &&
    session &&
    !session.user.mustChangePassword &&
    !session.user.mfaSetupRequired &&
    can(session.actor, 'items.view')
  ) {
    let visible = false;
    try {
      await getItem(db(), session.actor, scan.itemId);
      visible = true;
    } catch {
      // Not an item this person can see: they get the public page, like anyone else.
    }
    if (visible) redirect(`/items/${scan.itemId}`);
  }

  return (
    <main className="auth-page">
      <div className="auth-card stack">
        <p className="auth-product">
          <ProductMark />
        </p>
        {scan ? (
          <>
            <p className="muted">{scan.kindName}</p>
            <h1>{scan.assetNumber}</h1>
            <p className="notice notice-info">
              <strong>Report a fault: coming soon.</strong> You will be able to tell the owner about
              a problem with this item from here.
            </p>
          </>
        ) : (
          <>
            <h1>Label not recognised</h1>
            <p>
              This label isn’t recognised. It may have been replaced, or damaged. Ask the owner of
              the kit.
            </p>
          </>
        )}
        <p>
          <Link href="/login">Sign in</Link>
        </p>
      </div>
    </main>
  );
}
