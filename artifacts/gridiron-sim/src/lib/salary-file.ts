import { parseSalaryCsv, type LineupFormat } from './lineups';

/** Bound file reads so a stalled browser/device read cannot leave an import waiting forever. */
export async function readSalaryFile(file: Pick<File, 'size' | 'text'>, timeoutMs = 15000, format: LineupFormat = 'classic') {
  if (file.size > 2_000_000) throw new Error('Salary CSV is too large (maximum 2 MB).');
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const csv = await Promise.race([
      file.text(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Reading the file timed out. Download the CSV to your device and try again.')), timeoutMs);
      }),
    ]);
    const players = parseSalaryCsv(csv, format);
    return { csv, players };
  } finally {
    clearTimeout(timer);
  }
}