import { integer, jsonb, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";

export const seasonTeamsTable = pgTable("season_teams", {
  id: serial("id").primaryKey(),
  season: integer("season").notNull(),
  team: text("team").notNull(),
  version: integer("version").notNull().default(1),
  defenseTier: integer("defense_tier"),
  players: jsonb("players").notNull(),
  weeks: jsonb("weeks").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [uniqueIndex("season_teams_season_team_unique").on(table.season, table.team)]);

export const insertSeasonTeamSchema = createInsertSchema(seasonTeamsTable).omit({ id: true, updatedAt: true });
export type SeasonTeam = typeof seasonTeamsTable.$inferSelect;
export type InsertSeasonTeam = typeof seasonTeamsTable.$inferInsert;