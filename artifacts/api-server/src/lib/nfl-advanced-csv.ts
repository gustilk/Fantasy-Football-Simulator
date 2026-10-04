/** Bounded RFC-style CSV iteration: don't retain an entire season's play rows.
 * Handles embedded newlines and escaped quotes in nflverse descriptions. */
export function* csvRecords(text: string, expected: string[] = []): Generator<Record<string, string>> {
  let header: string[] | undefined, values: string[] = [], cell = '', quoted = false, closed = false;
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  for (let i = 0; i <= text.length; i++) {
    const char = i === text.length ? '\n' : text[i]!;
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; } else { quoted = false; closed = true; }
      } else cell += char;
    } else if (char === '"' && !cell && !closed) quoted = true;
    else if (char === ',' || char === '\n') {
      values.push(cell); cell = ''; closed = false;
      if (char === '\n') {
        if (values.some(value => value.trim())) {
          if (!header) {
            header = values.map(value => value.trim());
            if (new Set(header).size !== header.length) throw new Error('Duplicate source CSV columns.');
            if (expected.some(field => !header!.includes(field))) throw new Error('Advanced source CSV columns changed.');
          } else {
            if (values.length !== header.length) throw new Error('Incomplete source CSV row.');
            yield Object.fromEntries(header.map((name, index) => [name, values[index]!]));
          }
        }
        values = [];
      }
    } else if (char !== '\r') {
      if (char === '"' || (closed && char.trim())) throw new Error('Malformed source CSV quoting.');
      if (!closed) cell += char;
    }
  }
  if (quoted) throw new Error('Unclosed source CSV field.');
  if (!header) throw new Error('Empty source CSV.');
}
export const sourceNumber = (text: string | undefined): number | null => {
  if (!text?.trim() || !/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(text.trim())) return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
};
export function requireColumns(row: Record<string, string>, fields: string[]) {
  if (fields.some(field => !(field in row))) throw new Error(`Source columns changed: expected ${fields.join(', ')}.`);
}