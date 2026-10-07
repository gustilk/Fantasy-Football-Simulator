export const APP_SECTION_STORAGE_KEY = 'gridiron-last-section-v1';
export const APP_SECTIONS = ['draftkings', 'lineups', 'manual', 'library', 'standings', 'simulator'] as const;
export type AppSection = typeof APP_SECTIONS[number];
const isSection = (value: unknown): value is AppSection =>
  typeof value === 'string' && APP_SECTIONS.some(section => section === value);

/** Explicit links take priority over the last section used in this browser. */
export function initialAppSection(search: string, readStored: () => string | null): AppSection {
  const linked = new URLSearchParams(search).get('view');
  if (linked !== null) return isSection(linked) ? linked : 'draftkings';
  try {
    const remembered = readStored();
    return isSection(remembered) ? remembered : 'draftkings';
  } catch {
    return 'draftkings';
  }
}

/** Preserve the artifact path, unrelated query parameters, and fragment. */
export function appSectionUrl(href: string, section: AppSection): string {
  const url = new URL(href);
  url.searchParams.set('view', section);
  return `${url.pathname}${url.search}${url.hash}`;
}
