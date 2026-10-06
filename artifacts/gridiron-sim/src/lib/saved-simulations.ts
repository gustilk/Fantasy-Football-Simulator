import type { SimulationInput, SimulationResult, TeamSetup, WeatherSetup } from './simulator';

export type StoredSetup = {
  away: TeamSetup; home: TeamSetup; weather: WeatherSetup;
  importance?: SimulationInput['importance']; market?: SimulationInput['market'];
  showdownModel?: SimulationInput['showdownModel'];
  driveModel?: SimulationInput['driveModel'];
};
export type SavedSimulation = {
  id: string; savedAt: string; awayName: string; homeName: string;
  /** Captured for new weekly batches; absent on legacy archives. */
  generatedAt?: string;
  weeklyRunId?: string;
  result: SimulationResult; setup?: StoredSetup;
};
export const RESULTS_STORAGE_KEY = 'gridiron-sim-results-v1';
type StorageAccess = Pick<Storage, 'getItem' | 'setItem'>;

export function readSavedSimulations(storage: Pick<Storage, 'getItem'>): SavedSimulation[] {
  const parsed: unknown = JSON.parse(storage.getItem(RESULTS_STORAGE_KEY) || '[]');
  if (!Array.isArray(parsed)) throw new Error('Saved projections could not be read. Existing data has not been replaced.');
  return parsed;
}

/** Keep every game in a weekly run; never silently truncate a 16-game week to ten. */
export function saveSimulation(storage: StorageAccess, entry: SavedSimulation): SavedSimulation[] {
  const entries = [entry, ...readSavedSimulations(storage).filter(item => item.id !== entry.id)];
  try { storage.setItem(RESULTS_STORAGE_KEY, JSON.stringify(entries)); }
  catch { throw new Error('Could not save this projection. Browser storage is full or unavailable; previously saved results are unchanged.'); }
  return entries;
}

export function deleteSavedSimulation(storage: StorageAccess, id: string): SavedSimulation[] {
  const entries = readSavedSimulations(storage).filter(item => item.id !== id);
  storage.setItem(RESULTS_STORAGE_KEY, JSON.stringify(entries));
  return entries;
}