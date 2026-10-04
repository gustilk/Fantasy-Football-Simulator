# Saved NFL advanced-stat source

Use **nflverse** for ongoing advanced-stat reference data as the season progresses.

Source catalog: https://github.com/nflverse/nflverse-data/releases

## Saved download links

| Data | Current-season file |
| --- | --- |
| Play-by-play: targets, carries, air yards and defensive EPA | https://github.com/nflverse/nflverse-data/releases/download/pbp/play_by_play_2026.csv.gz |
| Player snap counts and reported snap shares | https://github.com/nflverse/nflverse-data/releases/download/snap_counts/snap_counts_2026.csv.gz |
| Player identities: GSIS/PFR IDs linked to ESPN IDs | https://github.com/nflverse/nflverse-data/releases/download/players/players.csv.gz |

For a different season, replace `2026` in the first two filenames with the selected season. The player-identity link is shared across seasons; its latest-team field must not determine a player's historical team.

These URLs are already used by the app's data service. No API key is required. Do not substitute another season or dummy numbers if a file is unavailable.

## Weekly refresh procedure

1. Wait for the NFL week's final game to finish, including Monday games or later rescheduled games.
2. Open **Team Library**, choose the team and season, and expand **Advanced NFL reference stats**.
3. Set **Games before week** to the completed week plus one. For example, after Week 4, select **Week 5**. After Week 18, select **Week 19**.
4. Click **Refresh**. Check the completed-game count, last verified completed week, each source's download/update time, and any partial-data warnings.
5. If a source has not yet incorporated the final game, try again later. Availability of one source does not prove that the other sources are current.

The selected cutoff remains authoritative: refreshing a report set to “before Week 4” will not add Week 4. The service fetches updated files on demand and caches them for ten minutes; a refresh during that window may reuse the downloaded files.

**There is no unattended weekly scheduler currently configured.** The saved source supports ongoing weekly pulls when the panel is opened or refreshed. Reports are read-only and are not automatically saved into roster/history documents.

## Data safeguards

- Include only verified completed regular-season games strictly before the cutoff and exclude future-dated games.
- Retain missing observations as unknown, not invented zeros. Use stable IDs rather than guessed player-name matches.
- Keep source-year data separate from current roster eligibility and the existing 2025 baseline.
- Show sack-or-QB-hit rate only as a limited proxy. A full pressure rate is unavailable from these files.
- Keep these stats reference-only. They do not automatically boost fantasy projections or modify existing saved forecasts.
- Current download timestamps do not establish that the data was available before a historical kickoff.