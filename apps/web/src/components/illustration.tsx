// NorthKit's pictures (copied from ClearRate's illustration component, S6-11; the house
// style): each in light and dark, swapped by the browser's colour scheme. Decorative unless
// given a label: the words beside it always say the same thing.

export type IllustrationName = 'auth-hero';

export function Illustration({
  name,
  className,
  label,
}: {
  name: IllustrationName;
  className?: string;
  /** Leave out for a decorative picture (the usual case). */
  label?: string;
}) {
  const base = `/illustrations/northkit-${name}`;
  return (
    <picture className={className ?? 'illustration'}>
      <source srcSet={`${base}-dark.svg`} media="(prefers-color-scheme: dark)" />
      {/* An SVG from our own public folder: Next's image pipeline adds nothing here. */}
      <img src={`${base}-light.svg`} alt={label ?? ''} width={480} height={320} />
    </picture>
  );
}
