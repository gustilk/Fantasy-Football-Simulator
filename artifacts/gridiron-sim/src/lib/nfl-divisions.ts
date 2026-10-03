/** Current NFL alignment. Historical seasons do not imply historical realignment. */
export const NFL_DIVISIONS = {
  'AFC East': ['Buffalo Bills', 'Miami Dolphins', 'New England Patriots', 'New York Jets'],
  'AFC North': ['Baltimore Ravens', 'Cincinnati Bengals', 'Cleveland Browns', 'Pittsburgh Steelers'],
  'AFC South': ['Houston Texans', 'Indianapolis Colts', 'Jacksonville Jaguars', 'Tennessee Titans'],
  'AFC West': ['Denver Broncos', 'Kansas City Chiefs', 'Las Vegas Raiders', 'Los Angeles Chargers'],
  'NFC East': ['Dallas Cowboys', 'New York Giants', 'Philadelphia Eagles', 'Washington Commanders'],
  'NFC North': ['Chicago Bears', 'Detroit Lions', 'Green Bay Packers', 'Minnesota Vikings'],
  'NFC South': ['Atlanta Falcons', 'Carolina Panthers', 'New Orleans Saints', 'Tampa Bay Buccaneers'],
  'NFC West': ['Arizona Cardinals', 'Los Angeles Rams', 'San Francisco 49ers', 'Seattle Seahawks'],
} as const;
export type NflDivision = keyof typeof NFL_DIVISIONS;
export const NFL_TEAM_NAMES = Object.values(NFL_DIVISIONS).flat().sort();
const memberships = new Map<string, NflDivision>(
  Object.entries(NFL_DIVISIONS).flatMap(([division, teams]) =>
    teams.map(team => [team.toLowerCase(), division as NflDivision] as const)),
);
export const getDivision = (team: string): NflDivision | undefined => memberships.get(team.trim().toLowerCase());
export function isDivisionGame(team: string, opponent: string): boolean {
  const division = getDivision(team);
  return !!division && division === getDivision(opponent) && team.trim().toLowerCase() !== opponent.trim().toLowerCase();
}