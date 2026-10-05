import { boolean, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { createInsertSchema } from 'drizzle-zod';

/** Structured contest rows, not original uploaded file bytes. Deleted rows retain
 * their revision so stale browser caches cannot silently restore an old contest. */
export const salaryUploadsTable = pgTable('salary_uploads', {
  season: integer('season').notNull(),
  format: text('format').notNull(),
  revision: integer('revision').notNull().default(1),
  filename: text('filename').notNull(),
  players: jsonb('players').notNull(),
  deleted: boolean('deleted').notNull().default(false),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, table => [uniqueIndex('salary_uploads_season_format_unique').on(table.season, table.format)]);
export const insertSalaryUploadSchema = createInsertSchema(salaryUploadsTable);
export type SalaryUpload = typeof salaryUploadsTable.$inferSelect;
export type InsertSalaryUpload = typeof salaryUploadsTable.$inferInsert;
