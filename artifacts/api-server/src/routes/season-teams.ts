import { Router, type IRouter } from "express";
import { eq, sql } from "drizzle-orm";
import { db, seasonTeamsTable } from "@workspace/db";
import { ListSeasonTeamsQueryParams, ListSeasonTeamsResponse, SaveSeasonTeamParams, SaveSeasonTeamBody, SaveSeasonTeamResponse } from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/season-teams", async (req, res): Promise<void> => {
  const query = ListSeasonTeamsQueryParams.safeParse(req.query);
  if (!query.success) { res.status(400).json({ error: "Choose a season from 2000 to 2100." }); return; }
  const teams = await db.select().from(seasonTeamsTable).where(eq(seasonTeamsTable.season, query.data.season)).orderBy(seasonTeamsTable.team);
  res.json(ListSeasonTeamsResponse.parse(teams));
});

router.put("/season-teams/:season/:team", async (req, res): Promise<void> => {
  const params = SaveSeasonTeamParams.safeParse(req.params);
  const body = SaveSeasonTeamBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid team data. Check names, season, weeks, and numeric stats." }); return;
  }
  const { season, team } = params.data;
  const { players, weeks, expectedVersion } = body.data;
  const fail = (message: string) => { res.status(400).json({ error: message }); };
  if (!team.trim() || players.some(p => !p.name.trim())) { fail("Team and player names cannot be blank."); return; }
  const ids = new Set(players.map(p => p.id));
  if (ids.size !== players.length) { fail("Each roster player must have a unique ID."); return; }
  const roles = new Set<string>();
  for (const player of players) {
    if (player.elite1x === true && (player.side !== "offense" || !["QB", "RB", "WR", "TE"].includes(player.position))) {
      fail("1x applies to offensive QB/RB/WR/TE players only."); return;
    }
    if (player.depthRank === undefined) continue;
    if (player.side !== "offense" || !["QB", "RB", "WR", "TE"].includes(player.position)) { fail("Depth roles apply to offensive QB/RB/WR/TE players only."); return; }
    const role = `${player.position}${player.depthRank}`;
    if (player.active && roles.has(role)) { fail(`Two active players cannot both be ${role}. Choose distinct depth ranks.`); return; }
    if (player.active) roles.add(role);
  }
  if (new Set(weeks.map(w => w.week)).size !== weeks.length) { fail("A week cannot be entered twice."); return; }
  if (weeks.filter(w => w.status === "played").length > 17) { fail("An NFL regular season has at most 17 played games."); return; }
  for (const week of weeks) {
    if (week.status !== "played" && (week.result !== "none" || Object.keys(week.playerStats).length || Object.keys(week.teamDefense).length)) {
      fail(`Week ${week.week}: bye/upcoming weeks cannot have results or game statistics.`); return;
    }
    if (week.status === "played" && (!week.opponent.trim() || week.opponent === team)) {
      fail(`Week ${week.week}: choose an opposing team.`); return;
    }
    if (week.teamScore !== null && week.opponentScore !== null && week.status === "played") {
      week.result = week.teamScore === week.opponentScore ? "T" : week.teamScore > week.opponentScore ? "W" : "L";
    }
    if (Object.keys(week.playerStats).some(id => !ids.has(id))) { fail(`Week ${week.week}: statistics refer to a player outside the roster.`); return; }
    for (const stats of [week.teamDefense, ...Object.values(week.playerStats)]) {
      if (Object.keys(stats).length > 64) { fail("Limit each stat line to 64 numeric fields."); return; }
      if (Object.entries(stats).some(([key, value]) => key.length > 60 || (value < 0 && !/yards/i.test(key)))) {
        fail(`Week ${week.week}: only yardage fields can be negative.`); return;
      }
      for (const [made, attempted] of [["passCompletions", "passAttempts"], ["receptions", "targets"], ["fieldGoalsMade", "fieldGoalAttempts"], ["extraPointsMade", "extraPointAttempts"]]) {
        if (stats[made!] !== undefined && stats[attempted!] !== undefined && stats[made!]! > stats[attempted!]!) {
          fail(`Week ${week.week}: ${made} cannot exceed ${attempted}.`); return;
        }
      }
    }
  }
  const [saved] = await db.insert(seasonTeamsTable).values({
    season, team: team.trim(), players, weeks, version: 1,
  }).onConflictDoUpdate({
    target: [seasonTeamsTable.season, seasonTeamsTable.team],
    set: { players, weeks, version: sql`${seasonTeamsTable.version} + 1`, updatedAt: new Date() },
    setWhere: eq(seasonTeamsTable.version, expectedVersion),
  }).returning();
  if (!saved) { res.status(409).json({ error: "This team changed in another session. Reload the saved version before trying again; your unsaved draft has not been submitted." }); return; }
  res.json(SaveSeasonTeamResponse.parse(saved));
});

export default router;