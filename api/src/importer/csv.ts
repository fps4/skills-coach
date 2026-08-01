/**
 * A small header-aware CSV reader.
 *
 * Header-aware rather than positional, because the source format documented its columns by *name*
 * and treats two of them as optional — a lesson number, and a second word order. A positional
 * parser would silently misread a file that omits one, so column order must not matter.
 *
 * Written by hand rather than pulled in as a dependency: the requirement is RFC-4180 quoting and
 * nothing else, and a public repository is better off with one fewer supply-chain edge.
 */

/** Split one CSV line, honouring `"quoted, fields"` and `""` as an escaped quote. */
export function splitLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let quoted = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (quoted) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        current += char;
      }
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === ',') {
      fields.push(current);
      current = '';
    } else current += char;
  }
  fields.push(current);
  return fields.map((field) => field.trim());
}

/**
 * Split a CSV document into lines, keeping newlines that sit inside a quoted field intact.
 * The source files carry example sentences with commas and, occasionally, line breaks.
 */
function splitRecords(text: string): string[] {
  const records: string[] = [];
  let current = '';
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === '"') quoted = !quoted;
    if (!quoted && (char === '\n' || char === '\r')) {
      if (char === '\r' && text[i + 1] === '\n') i += 1;
      records.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  if (current.length > 0) records.push(current);
  return records;
}

export type CsvRow = Record<string, string>;

export interface CsvDocument {
  headers: string[];
  rows: CsvRow[];
}

export function parseCsv(text: string): CsvDocument {
  // Strip a UTF-8 BOM — spreadsheet exports routinely carry one, and it would corrupt the first header.
  const records = splitRecords(text.replace(/^\uFEFF/, '')).filter((line) => line.trim().length > 0);
  if (records.length === 0) return { headers: [], rows: [] };

  const headers = splitLine(records[0] as string);
  const rows: CsvRow[] = [];

  for (const record of records.slice(1)) {
    const fields = splitLine(record);
    const row: CsvRow = {};
    headers.forEach((header, index) => {
      row[header] = fields[index] ?? '';
    });
    rows.push(row);
  }

  return { headers, rows };
}

/**
 * Read a column by any of several accepted names, case-insensitively.
 *
 * Column names are content, not contract: the source files are Dutch, another pack's would not be.
 * Accepting a list of aliases is what keeps the importer from being language-specific.
 */
export function column(row: CsvRow, names: string[]): string | undefined {
  const lowered = new Map(Object.entries(row).map(([key, value]) => [key.toLocaleLowerCase(), value]));
  for (const name of names) {
    const value = lowered.get(name.toLocaleLowerCase());
    if (value !== undefined && value.trim().length > 0) return value.trim();
  }
  return undefined;
}

/** The chunk separator the word-order format uses: space, pipe, space. */
export function splitParts(value: string): string[] {
  return value
    .split('|')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}
