import { parseSalaryCsv, type LineupFormat } from './lineups';

export const LEGACY_SALARY_KEY = 'gridiron-dk-salaries-v1';
export const salaryStorageKey = (format: LineupFormat) => `gridiron-dk-${format}-salaries-v1`;
export interface SavedSalaries {
  version: 1; season: number; filename: string; importedAt: string;
  slateId: string; sunday: string; csv: string; format?: LineupFormat; gameId?: string;
}
export type SavedSalaryState =
  | { status: 'none' }
  | { status: 'corrupt'; reason: string }
  | { status: 'other-season'; record: SavedSalaries }
  | { status: 'ok'; record: SavedSalaries };
type SalaryStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function legacyFormat(raw: string): LineupFormat {
  try { return JSON.parse(raw)?.format === 'showdown' ? 'showdown' : 'classic'; }
  catch { return 'classic'; }
}
function validate(raw: string, format: LineupFormat): SavedSalaries {
  const r = JSON.parse(raw) as Partial<SavedSalaries>;
  if (!r || r.version !== 1 || typeof r.season !== 'number' || typeof r.csv !== 'string' ||
    typeof r.filename !== 'string' || typeof r.importedAt !== 'string' ||
    typeof r.slateId !== 'string' || typeof r.sunday !== 'string' ||
    (r.format ?? 'classic') !== format || (r.gameId !== undefined && typeof r.gameId !== 'string')) {
    throw new Error('Unrecognized salary file format or version.');
  }
  parseSalaryCsv(r.csv, format);
  return r as SavedSalaries;
}

/** Read legacy data only in its own format. Do not move or delete archives
 * automatically, and never let a new upload overwrite the other format. */
export function loadSalaryFile(storage: Pick<Storage, 'getItem'>, season: number, format: LineupFormat): SavedSalaryState {
  try {
    let raw = storage.getItem(salaryStorageKey(format));
    if (raw === null) {
      const legacy = storage.getItem(LEGACY_SALARY_KEY);
      if (legacy === null || legacyFormat(legacy) !== format) return { status: 'none' };
      raw = legacy;
    }
    const record = validate(raw, format);
    return record.season === season ? { status: 'ok', record } : { status: 'other-season', record };
  } catch (e) {
    return { status: 'corrupt', reason: e instanceof Error ? e.message : 'Browser salary storage is unreadable.' };
  }
}

export function saveSalaryFile(storage: Pick<Storage, 'setItem'>, record: SavedSalaries, format: LineupFormat) {
  const raw = JSON.stringify(record);
  validate(raw, format);
  storage.setItem(salaryStorageKey(format), raw);
}

export function removeSalaryFile(storage: SalaryStorage, format: LineupFormat) {
  const legacy = storage.getItem(LEGACY_SALARY_KEY);
  // Explicit removal must not resurrect an older file through legacy fallback.
  if (legacy !== null && legacyFormat(legacy) === format) storage.removeItem(LEGACY_SALARY_KEY);
  storage.removeItem(salaryStorageKey(format));
}
