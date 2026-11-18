import readXlsxFile from 'read-excel-file/node';
import writeXlsxFile from 'write-excel-file/node';

// Excel (.xlsx) reading and writing, copied from ClearRate's packages/import/src/xlsx.ts and
// adapted (read-excel-file and write-excel-file, both MIT, docs/dependencies.md):
//   - the reader takes each cell's stored value and never calculates a formula: a formula
//     cell gives the result Excel saved with it, and macros are never run (.xlsm and every
//     other type is refused upstream, by the file's bytes as well as its name).
//   - numbers are read as the exact text stored in the file, never through a JavaScript
//     float, so 3.50 stays "3.5".

/** Largest workbook read. A register import of 2,000 rows is far smaller. */
export const MAX_WORKBOOK_BYTES = 5 * 1024 * 1024;

export type CellIn = string | number | null;

export interface SheetOut {
  name: string;
  header: string[];
  rows: CellIn[][];
  widths?: number[];
}

/** Writes sheets to an .xlsx file in memory. The header row is bold. */
export async function writeWorkbook(sheets: SheetOut[]): Promise<Buffer> {
  const data = sheets.map((sheet) => [
    sheet.header.map((h) => ({ value: h, type: String, fontWeight: 'bold' as const })),
    ...sheet.rows.map((row) =>
      row.map((cell) =>
        cell === null || cell === ''
          ? null
          : typeof cell === 'number'
            ? { value: cell, type: Number }
            : { value: cell, type: String },
      ),
    ),
  ]);
  const result = writeXlsxFile(
    data.map((rows, i) => ({
      data: rows,
      sheet: sheets[i]!.name,
      columns: sheets[i]!.widths?.map((width) => ({ width })),
    })),
  );
  return result.toBuffer();
}

export interface SheetIn {
  /** Header cells, trimmed. */
  header: string[];
  /** Data rows with their 1-based row number in the sheet (the header is row 1). */
  rows: { row: number; cells: (string | null)[] }[];
}

function asText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) {
    // A cell Excel stored as a date: read its calendar date (the file has no time zone).
    const y = value.getUTCFullYear();
    const m = String(value.getUTCMonth() + 1).padStart(2, '0');
    const d = String(value.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const text = String(value).trim();
  return text === '' ? null : text;
}

/** Reads the first sheet of an .xlsx file as text cells. Throws on a file that isn't one. */
export async function readFirstSheet(file: Buffer): Promise<SheetIn> {
  if (file.byteLength > MAX_WORKBOOK_BYTES) throw new RangeError('The file is larger than 5 MB.');
  let sheets: { sheet: string; data: unknown[][] }[];
  try {
    sheets = await readXlsxFile<string>(file, { parseNumber: (s: string) => s });
  } catch {
    throw new RangeError('This isn’t an Excel (.xlsx) file NorthKit can read.');
  }
  const first = sheets[0]?.data ?? [];
  const [head = [], ...body] = first;
  const header = head.map((h) => asText(h) ?? '');
  const rows = body
    .map((cells, i) => ({ row: i + 2, cells: header.map((_, c) => asText(cells[c])) }))
    .filter((r) => r.cells.some((c) => c !== null));
  return { header, rows };
}
