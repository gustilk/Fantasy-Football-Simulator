import type { SharedSalaryFile } from '@workspace/api-client-react';
import { parseSalaryCsv, type SalaryPlayer, type LineupFormat } from './lineups';
import type { SavedSalaries } from './salary-storage';

export function salaryRowsCsv(players: SalaryPlayer[]): string {
  const quote = (value: string | number) => `"${String(value).replace(/"/g, '""')}"`;
  return 'ID,Name,Position,TeamAbbrev,Salary,Game Info,Roster Position\r\n' +
    players.map(p => [p.id, p.name, p.position, p.team, p.salary, p.gameInfo, p.rosterPosition].map(quote).join(',')).join('\r\n') + '\r\n';
}
/** The file travels across devices; pairing stays local because forecast archives
 * are device-specific. Only reuse a pairing for identical contest salary rows. */
export function sharedSalaryRecord(file: SharedSalaryFile, local?: SavedSalaries): SavedSalaries {
  const format: LineupFormat = file.format;
  const csv = salaryRowsCsv(file.players);
  parseSalaryCsv(csv, format);
  let same = false;
  try { same = !!local && local.season === file.season && (local.format ?? 'classic') === format &&
    salaryRowsCsv(parseSalaryCsv(local.csv, format)) === csv; } catch { /* A corrupt local pairing is never reused. */ }
  return { version: 1, season: file.season, format, filename: file.filename, importedAt: file.importedAt, csv,
    slateId: same ? local!.slateId : '', sunday: same ? local!.sunday : '',
    ...(format === 'showdown' ? { gameId: same ? local!.gameId ?? '' : '' } : {}) };
}
