import { TEAM_CODES, type SalaryPlayer } from './lineups';
import type { ManualPicks } from './manual-lineups';

export const MANUAL_PLAYER_PAGE_SIZE = 25;
export interface ManualPlayerFilters {
  query: string;
  position: string;
  team: string;
  game: string;
  selectedOnly: boolean;
}
export const EMPTY_MANUAL_PLAYER_FILTERS: ManualPlayerFilters = {
  query: '', position: '', team: '', game: '', selectedOnly: false,
};
const searchable = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** View filters never change the candidate pool, selections, or entered estimates. */
export function filterManualPlayers<T extends SalaryPlayer>(players: T[], picks: ManualPicks, filters: ManualPlayerFilters): T[] {
  const terms = filters.query.trim().split(/\s+/).filter(Boolean).map(searchable).filter(Boolean);
  return players.filter(p => (!filters.position || p.position === filters.position)
    && (!filters.team || p.team === filters.team)
    && (!filters.game || p.gameInfo === filters.game)
    && (!filters.selectedOnly || picks[p.id]?.selected)
    && terms.every(term => searchable(`${p.name} ${p.team} ${TEAM_CODES[p.team] ?? ''}`).includes(term)))
    .sort((a, b) => b.salary - a.salary || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

export function manualPlayerPage<T>(rows: T[], requestedPage: number) {
  const pages = Math.max(1, Math.ceil(rows.length / MANUAL_PLAYER_PAGE_SIZE));
  const page = Math.max(1, Math.min(pages, Math.trunc(requestedPage) || 1));
  const start = (page - 1) * MANUAL_PLAYER_PAGE_SIZE;
  return { rows: rows.slice(start, start + MANUAL_PLAYER_PAGE_SIZE), page, pages, start: rows.length ? start + 1 : 0,
    end: Math.min(start + MANUAL_PLAYER_PAGE_SIZE, rows.length) };
}
