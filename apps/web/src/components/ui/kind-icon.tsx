import {
  Anchor,
  Construction,
  Drill,
  Gauge,
  Package,
  PlugZap,
  Rows4,
  Shield,
  Tractor,
  type LucideIcon,
} from 'lucide-react';

// One Lucide icon per kind of kit (K32). Lucide has no ladder, so a ladder is drawn as its
// rungs. A kind added by the customer, or renamed, gets the plain package icon.
const BY_KIND: Record<string, LucideIcon> = {
  'power tool': Drill,
  'lifting gear': Anchor,
  'access equipment': Construction,
  ladder: Rows4,
  harness: Shield,
  'pat item': PlugZap,
  'test instrument': Gauge,
  plant: Tractor,
};

export function kindIcon(kindName: string): LucideIcon {
  return BY_KIND[kindName.trim().toLowerCase()] ?? Package;
}

/** The kind's icon in a 32 px chip, for the identity column and card headers. */
export function KindChip({ kindName }: { kindName: string }) {
  const Icon = kindIcon(kindName);
  return (
    <span className="icon-chip" aria-hidden="true">
      <Icon size={18} className="icon" />
    </span>
  );
}
