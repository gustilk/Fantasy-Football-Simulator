import { integer, jsonb, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { createInsertSchema } from 'drizzle-zod';
import { z } from 'zod/v4';

export const manualPicksTable = pgTable('manual_picks', {
  season: integer('season').notNull(),
  contestHash: text('contest_hash').notNull(),
  signature: text('signature').notNull(),
  revision: integer('revision').notNull().default(1),
  picks: jsonb('picks').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, table => [uniqueIndex('manual_picks_season_contest_unique').on(table.season, table.contestHash)]);

export const insertManualPicksSchema = createInsertSchema(manualPicksTable);
export type InsertManualPicks = z.infer<typeof insertManualPicksSchema>;
export type StoredManualPicks = typeof manualPicksTable.$inferSelect;
