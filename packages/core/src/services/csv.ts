/**
 * Parses CSV (RFC 4180): comma-separated, fields optionally in double quotes, a
 * doubled quote inside quotes, line breaks inside quotes, CRLF or LF, an optional
 * UTF-8 byte-order mark. Returns rows of raw strings with the 1-based line each
 * row started on, so errors can point at the right line. Blank lines are skipped.
 */
export function parseCsv(text: string): { line: number; cells: string[] }[] {
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: { line: number; cells: string[] }[] = [];
  let cells: string[] = [];
  let cell = '';
  let quoted = false;
  let line = 1;
  let rowStart = 1;
  let i = 0;
  const endRow = () => {
    cells.push(cell);
    if (!(cells.length === 1 && cells[0] === '')) rows.push({ line: rowStart, cells });
    cells = [];
    cell = '';
  };
  while (i < input.length) {
    const c = input[i]!;
    if (quoted) {
      if (c === '"') {
        if (input[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        quoted = false;
      } else {
        if (c === '\n') line += 1;
        cell += c;
      }
      i += 1;
      continue;
    }
    if (c === '"' && cell === '') quoted = true;
    else if (c === ',') {
      cells.push(cell);
      cell = '';
    } else if (c === '\r' && input[i + 1] === '\n') {
      endRow();
      line += 1;
      rowStart = line;
      i += 2;
      continue;
    } else if (c === '\n' || c === '\r') {
      endRow();
      line += 1;
      rowStart = line;
    } else cell += c;
    i += 1;
  }
  if (quoted) throw new Error(`A quoted field starting on line ${rowStart} is never closed.`);
  if (cell !== '' || cells.length) endRow();
  return rows;
}

/** One CSV field, quoted when it needs to be. */
export function csvField(value: string | number | boolean | null | undefined): string {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\r\n]/.test(text) || /^\s|\s$/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(rows: (string | number | boolean | null | undefined)[][]): string {
  return rows.map((row) => row.map(csvField).join(',')).join('\r\n') + '\r\n';
}

/**
 * Text that a spreadsheet would run as a formula (=, +, -, @, tab or carriage return
 * first) gets a leading apostrophe, so a value someone typed into NorthKit can't become
 * a formula when a report is opened in Excel (OWASP "CSV injection"). Numbers are left
 * alone. The full data export keeps values exactly as stored instead.
 */
export function spreadsheetSafe<T>(value: T): T | string {
  return typeof value === 'string' && /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

/** CSV for people to open in a spreadsheet: formula-safe, with a byte-order mark for Excel. */
export function toReportCsv(rows: (string | number | boolean | null | undefined)[][]): string {
  return `\ufeff${toCsv(rows.map((row) => row.map((v) => spreadsheetSafe(v))))}`;
}
