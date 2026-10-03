// Development-only initial load. Never overwrites a saved team, even on races.
const season = Number(process.argv[2] ?? 2026);
if (!Number.isInteger(season) || season < 2000 || season > 2100 || !process.env.REPLIT_DEV_DOMAIN) {
  throw new Error("Usage: node scripts/preload-nfl.mjs <season> in the Replit development workspace.");
}
const base = `https://${process.env.REPLIT_DEV_DOMAIN}/api`;
async function request(path, method = "GET", data) {
  const response = await fetch(base + path, {
    method, ...(data ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) } : {}),
    signal: AbortSignal.timeout(120_000),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(`${response.status}: ${result.error ?? "NFL import failed"}`);
  return result;
}
const saved = await request(`/season-teams?season=${season}`);
const existing = new Set(saved.map(team => team.team));
const list = await (await fetch("https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams?limit=32")).json();
const names = list.sports[0].leagues[0].teams.map(t => t.team.displayName);
if (names.length !== 32 || new Set(names).size !== 32) throw new Error("Expected exactly 32 NFL teams from ESPN.");
const queue = names.filter(name => !existing.has(name));
let loaded = 0;
const failed = [];
async function worker() {
  while (queue.length) {
    const team = queue.shift();
    try {
      const preview = await request(`/nfl-import/${season}/${encodeURIComponent(team)}`, "POST");
      const weeks = Array.from({ length: 18 }, (_, i) => preview.weeks.find(w => w.week === i + 1) ?? ({
        week: i + 1, status: "upcoming", opponent: "", venue: "home", result: "none",
        teamScore: null, opponentScore: null, teamDefense: {}, playerStats: {},
      }));
      await request(`/season-teams/${season}/${encodeURIComponent(team)}`, "PUT", { expectedVersion: 0, players: preview.players, weeks });
      loaded++;
      console.log(`Loaded ${team}: ${preview.players.length} players, weeks ${preview.weeks.map(w => w.week).join(", ")}.`);
    } catch (error) {
      failed.push({ team, error: error.message });
      console.error(`Not imported: ${team}: ${error.message}`);
    }
  }
}
await Promise.all([worker(), worker()]);
console.log(JSON.stringify({ season, loaded, preservedExisting: existing.size, failed }));
if (failed.length) process.exitCode = 1;