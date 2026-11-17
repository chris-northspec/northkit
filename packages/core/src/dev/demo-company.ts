// The fictional demo company for `pnpm db:seed-demo` (S1-10): a contractor with three
// depots, six vans and about 600 items of tools and equipment. Every name, place and
// serial number is invented (clean room): no real company, person or address.
//
// The data is generated from a fixed seed, so every run makes the same company. The item
// list is plain data here because the items table arrives in Sprint 2; the seed checks it
// (checkDemoCompany) and Sprint 2 loads it. Nothing in this file touches the database.

export interface DemoSite {
  code: string;
  name: string;
  town: string;
  postcode: string;
}

export interface DemoLocation {
  siteCode: string;
  code: string;
  name: string;
  kind: 'store' | 'van' | 'yard' | 'site';
  reference: string | null;
}

export const ITEM_KINDS = [
  'power_tool',
  'lifting_gear',
  'access_equipment',
  'ladder',
  'harness',
  'pat_item',
  'test_instrument',
  'plant',
] as const;
export type DemoItemKind = (typeof ITEM_KINDS)[number];

export interface DemoItem {
  /** The label text and QR code content later sprints print, unique across the company. */
  tag: string;
  kind: DemoItemKind;
  name: string;
  make: string;
  model: string;
  serial: string;
  purchasedOn: string;
  costPence: number;
  ownership: 'owned' | 'hired_in';
  siteCode: string;
  /** Code of the location the item is stored in or on. */
  locationCode: string;
}

export interface DemoUser {
  email: string;
  name: string;
  role: 'admin' | 'kit_manager' | 'supervisor' | 'operative' | 'viewer';
  /** Depots the person works at; empty means every depot. */
  siteCodes: string[];
}

export const DEMO_COMPANY_NAME = 'Fernbrook Contracting Ltd (fictional)';

export const DEMO_SITES: DemoSite[] = [
  { code: 'ASH', name: 'Ashgrove depot', town: 'Ashgrove', postcode: 'ZZ10 1AA' },
  { code: 'BRK', name: 'Brookfield depot', town: 'Brookfield', postcode: 'ZZ20 2BB' },
  { code: 'CLY', name: 'Clayhill depot', town: 'Clayhill', postcode: 'ZZ30 3CC' },
];

function vanNo(siteCode: string, n: number): string {
  return String(DEMO_SITES.findIndex((s) => s.code === siteCode) * 2 + n + 10);
}

/** Two vans, a store, a cage and a yard per depot; plus two job sites the kit can be out on. */
export const DEMO_LOCATIONS: DemoLocation[] = [
  ...DEMO_SITES.flatMap((s): DemoLocation[] => [
    {
      siteCode: s.code,
      code: `${s.code}-STORE`,
      name: 'Main store',
      kind: 'store',
      reference: null,
    },
    {
      siteCode: s.code,
      code: `${s.code}-CAGE`,
      name: 'Lockable cage',
      kind: 'store',
      reference: null,
    },
    { siteCode: s.code, code: `${s.code}-YARD`, name: 'Plant yard', kind: 'yard', reference: null },
    {
      siteCode: s.code,
      code: `${s.code}-VAN1`,
      name: 'Van 1',
      kind: 'van',
      reference: `ZZ${vanNo(s.code, 1)} DEM`,
    },
    {
      siteCode: s.code,
      code: `${s.code}-VAN2`,
      name: 'Van 2',
      kind: 'van',
      reference: `ZZ${vanNo(s.code, 2)} DEM`,
    },
  ]),
  {
    siteCode: 'ASH',
    code: 'ASH-JOB-MILL',
    name: 'Mill Lane refurbishment (job site)',
    kind: 'site',
    reference: 'JOB-2041',
  },
  {
    siteCode: 'BRK',
    code: 'BRK-JOB-SCHOOL',
    name: 'Brookfield school extension (job site)',
    kind: 'site',
    reference: 'JOB-2057',
  },
];

export const DEMO_USERS: DemoUser[] = [
  { email: 'demo.admin@northkit.test', name: 'Alex Example', role: 'admin', siteCodes: [] },
  {
    email: 'demo.kitmanager@northkit.test',
    name: 'Sam Sample',
    role: 'kit_manager',
    siteCodes: [],
  },
  {
    email: 'demo.supervisor.ash@northkit.test',
    name: 'Jo Placeholder',
    role: 'supervisor',
    siteCodes: ['ASH'],
  },
  {
    email: 'demo.supervisor.brk@northkit.test',
    name: 'Kim Specimen',
    role: 'supervisor',
    siteCodes: ['BRK'],
  },
  {
    email: 'demo.operative1@northkit.test',
    name: 'Lee Demo',
    role: 'operative',
    siteCodes: ['ASH'],
  },
  {
    email: 'demo.operative2@northkit.test',
    name: 'Max Demo',
    role: 'operative',
    siteCodes: ['ASH'],
  },
  {
    email: 'demo.operative3@northkit.test',
    name: 'Noor Demo',
    role: 'operative',
    siteCodes: ['BRK'],
  },
  {
    email: 'demo.operative4@northkit.test',
    name: 'Pat Demo',
    role: 'operative',
    siteCodes: ['CLY'],
  },
  { email: 'demo.viewer@northkit.test', name: 'Robin Viewer', role: 'viewer', siteCodes: [] },
];

interface KindSpec {
  kind: DemoItemKind;
  prefix: string;
  /** Items per depot. */
  perSite: number;
  names: readonly (readonly [name: string, make: string, model: string])[];
  costRange: readonly [low: number, high: number];
}

// Makes and models are invented (no real brand), so nothing here implies a product.
const SPECS: KindSpec[] = [
  {
    kind: 'power_tool',
    prefix: 'PT',
    perSite: 70,
    names: [
      ['Cordless drill', 'Marlowe', 'MD-18'],
      ['Impact driver', 'Marlowe', 'MI-18'],
      ['SDS hammer drill', 'Hartwell', 'HX-26'],
      ['Angle grinder 115 mm', 'Hartwell', 'AG-115'],
      ['Reciprocating saw', 'Marlowe', 'MR-18'],
      ['Circular saw', 'Dunmere', 'CS-190'],
    ],
    costRange: [6_000, 45_000],
  },
  {
    kind: 'lifting_gear',
    prefix: 'LG',
    perSite: 18,
    names: [
      ['Chain block 1 t', 'Aldwick', 'CB-1000'],
      ['Webbing sling 2 t', 'Aldwick', 'WS-2000'],
      ['Lever hoist 0.75 t', 'Aldwick', 'LH-750'],
      ['Shackle set', 'Aldwick', 'SH-SET'],
    ],
    costRange: [2_500, 38_000],
  },
  {
    kind: 'access_equipment',
    prefix: 'AE',
    perSite: 12,
    names: [
      ['Podium steps', 'Stanfield', 'PS-2.0'],
      ['Tower scaffold section', 'Stanfield', 'TS-4'],
      ['Platform trestle', 'Stanfield', 'PT-1.2'],
    ],
    costRange: [9_000, 120_000],
  },
  {
    kind: 'ladder',
    prefix: 'LD',
    perSite: 22,
    names: [
      ['Triple extension ladder', 'Stanfield', 'TE-3x9'],
      ['Stepladder 8 tread', 'Stanfield', 'SL-8'],
      ['Combination ladder', 'Stanfield', 'CL-3.5'],
    ],
    costRange: [6_500, 32_000],
  },
  {
    kind: 'harness',
    prefix: 'HN',
    perSite: 14,
    names: [
      ['Full-body harness', 'Kestrel Safety', 'FB-2'],
      ['Fall-arrest lanyard', 'Kestrel Safety', 'FL-2'],
      ['Rescue kit', 'Kestrel Safety', 'RK-1'],
    ],
    costRange: [4_500, 28_000],
  },
  {
    kind: 'pat_item',
    prefix: 'PA',
    perSite: 38,
    names: [
      ['110 V site transformer', 'Marlowe', 'ST-3.3'],
      ['Extension reel 25 m', 'Dunmere', 'ER-25'],
      ['Work light', 'Dunmere', 'WL-110'],
      ['Heater', 'Dunmere', 'HT-3'],
    ],
    costRange: [2_000, 24_000],
  },
  {
    kind: 'test_instrument',
    prefix: 'TI',
    perSite: 8,
    names: [
      ['Multifunction tester', 'Calder', 'MFT-7'],
      ['Clamp meter', 'Calder', 'CM-4'],
      ['Portable appliance tester', 'Calder', 'PAT-2'],
      ['Moisture meter', 'Calder', 'MM-1'],
    ],
    costRange: [8_000, 95_000],
  },
  {
    kind: 'plant',
    prefix: 'PL',
    perSite: 18,
    names: [
      ['Petrol generator 3.5 kVA', 'Hartwell', 'GN-35'],
      ['Plate compactor', 'Hartwell', 'PC-60'],
      ['Concrete mixer', 'Dunmere', 'CM-140'],
      ['Dehumidifier', 'Dunmere', 'DH-50'],
      ['Pressure washer', 'Hartwell', 'PW-150'],
    ],
    costRange: [30_000, 340_000],
  },
];

/** A small seeded random number generator, so every run makes the same company. */
function random(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = <T>(list: readonly T[], rnd: () => number): T =>
  list[Math.floor(rnd() * list.length)]!;

/** Where an item of this kind usually lives at a depot. */
function homeLocation(kind: DemoItemKind, siteCode: string, rnd: () => number): string {
  const r = rnd();
  switch (kind) {
    case 'plant':
      return `${siteCode}-YARD`;
    case 'ladder':
    case 'access_equipment':
      return r < 0.5 ? `${siteCode}-YARD` : r < 0.8 ? `${siteCode}-VAN1` : `${siteCode}-VAN2`;
    case 'test_instrument':
    case 'harness':
      return r < 0.6 ? `${siteCode}-CAGE` : r < 0.8 ? `${siteCode}-VAN1` : `${siteCode}-VAN2`;
    default:
      return r < 0.55
        ? `${siteCode}-STORE`
        : r < 0.7
          ? `${siteCode}-VAN1`
          : r < 0.85
            ? `${siteCode}-VAN2`
            : `${siteCode}-CAGE`;
  }
}

export function buildDemoItems(): DemoItem[] {
  const items: DemoItem[] = [];
  const rnd = random(20261117);
  let serialCounter = 100_000;
  for (const site of DEMO_SITES) {
    for (const spec of SPECS) {
      for (let n = 1; n <= spec.perSite; n++) {
        const [name, make, model] = pick(spec.names, rnd);
        const year = 2019 + Math.floor(rnd() * 8);
        const month = 1 + Math.floor(rnd() * 12);
        const cost =
          spec.costRange[0] + Math.floor(rnd() * (spec.costRange[1] - spec.costRange[0]));
        serialCounter += 1 + Math.floor(rnd() * 7);
        items.push({
          tag: `${site.code}-${spec.prefix}-${String(n).padStart(3, '0')}`,
          kind: spec.kind,
          name,
          make,
          model,
          serial: `${make.slice(0, 2).toUpperCase()}${year}-${serialCounter}`,
          purchasedOn: `${year}-${String(month).padStart(2, '0')}-01`,
          costPence: Math.round(cost / 100) * 100,
          ownership: spec.kind === 'plant' && rnd() < 0.25 ? 'hired_in' : 'owned',
          siteCode: site.code,
          locationCode: homeLocation(spec.kind, site.code, rnd),
        });
      }
    }
  }
  return items;
}

/** Returns every problem found in the demo company; empty means it is consistent. */
export function checkDemoCompany(items: readonly DemoItem[] = buildDemoItems()): string[] {
  const problems: string[] = [];
  const locations = new Set(DEMO_LOCATIONS.map((l) => l.code));
  const siteCodes = new Set(DEMO_SITES.map((s) => s.code));
  const tags = new Set<string>();
  const serials = new Set<string>();
  for (const l of DEMO_LOCATIONS)
    if (!siteCodes.has(l.siteCode))
      problems.push(`location ${l.code}: unknown depot ${l.siteCode}`);
  for (const i of items) {
    if (tags.has(i.tag)) problems.push(`duplicate tag ${i.tag}`);
    tags.add(i.tag);
    if (serials.has(i.serial)) problems.push(`duplicate serial ${i.serial}`);
    serials.add(i.serial);
    if (!locations.has(i.locationCode))
      problems.push(`${i.tag}: unknown location ${i.locationCode}`);
    else if (!i.locationCode.startsWith(`${i.siteCode}-`))
      problems.push(`${i.tag}: location ${i.locationCode} is at another depot`);
  }
  return problems;
}
