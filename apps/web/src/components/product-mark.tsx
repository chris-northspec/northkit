/**
 * The identity (house style, as NorthSlot): the NorthKit mark and wordmark ("North" then
 * "Kit" in Kit Teal, Kit Teal Light on the Ink sidebar), with the customer's organisation
 * name under it once set-up names it. The mark is decorative: the text beside it says what
 * it is. A plain <img>: an SVG gains nothing from next/image. The mark, wordmark and accent
 * are placeholders until BrandCentre chooses them (name check first).
 */
export function ProductMark({ organisation }: { organisation?: string | null }) {
  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/mark.svg" alt="" width={32} height={32} />
      <span className="brand-name">
        <span className="wordmark">
          North<span className="wordmark-kit">Kit</span>
        </span>
        {organisation ? <span className="brand-org">{organisation}</span> : null}
      </span>
    </>
  );
}
