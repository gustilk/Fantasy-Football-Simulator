import { Router, type IRouter } from 'express';
import { and, eq, sql } from 'drizzle-orm';
import { db, salaryUploadsTable } from '@workspace/db';
import { SaveSharedSalaryFileBody, DeleteSharedSalaryFileBody, GetSharedSalaryFileResponse } from '@workspace/api-zod';

const router: IRouter = Router();
const teams = new Set('ARI ATL BAL BUF CAR CHI CIN CLE DAL DEN DET GB HOU IND JAX KC LV LAC LAR MIA MIN NE NO NYG NYJ PHI PIT SEA SF TB TEN WAS'.split(' '));
const nameKey = (name: string) => name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  .replace(/\b(jr|sr|ii|iii|iv)\b\.?/g, '').replace(/[^a-z0-9]/g, '');
type Row = { id: string; name: string; position: string; team: string; salary: number; gameInfo: string; rosterPosition: string };
function validateRows(players: Row[], format: string) {
  const ids = new Set<string>(), roles = new Set<string>();
  for (const p of players) {
    const key = `${p.team}:${nameKey(p.name)}${format === 'showdown' ? `:${p.rosterPosition}` : ''}`;
    if (!teams.has(p.team) || ids.has(p.id) || roles.has(key)) throw new Error('Invalid or duplicate salary row.');
    if (format === 'classic' ? p.position === 'K' || p.rosterPosition.includes('CPT') || !p.rosterPosition.split('/').includes(p.position)
      : !['CPT', 'FLEX'].includes(p.rosterPosition)) throw new Error('Salary rows do not match the selected contest format.');
    ids.add(p.id); roles.add(key);
  }
  if (format === 'showdown') {
    if (new Set(players.map(p => p.team)).size !== 2 || new Set(players.map(p => p.gameInfo.trim().replace(/\s+/g, ' ').toUpperCase())).size !== 1) throw new Error('Showdown needs exactly one matchup and both teams.');
    const flex = players.filter(p => p.rosterPosition === 'FLEX'), captains = players.filter(p => p.rosterPosition === 'CPT');
    if (flex.length !== captains.length) throw new Error('Captain/FLEX salary rows must be paired.');
    for (const p of flex) {
      const c = captains.find(c => c.team === p.team && nameKey(c.name) === nameKey(p.name));
      if (!c || c.position !== p.position || c.salary !== p.salary * 1.5) throw new Error('Missing or inconsistent Captain salary row.');
    }
  }
}
function scope(seasonValue: string, format: string) {
  const season = Number(seasonValue);
  if (!Number.isInteger(season) || season < 2000 || season > 2100 || !['classic', 'showdown'].includes(format)) throw new Error('Invalid season or salary format.');
  return { season, format };
}
function state(row?: typeof salaryUploadsTable.$inferSelect) {
  return GetSharedSalaryFileResponse.parse({
    revision: row?.revision ?? 0,
    file: !row || row.deleted ? null : {
      season: row.season, format: row.format, filename: row.filename,
      importedAt: row.updatedAt.toISOString(), players: row.players,
    },
  });
}
router.get('/salary-files/:season/:format', async (req, res) => {
  let key;
  try { key = scope(req.params.season, req.params.format); }
  catch { res.status(400).json({ error: 'Invalid season or format.' }); return; }
  const [row] = await db.select().from(salaryUploadsTable).where(and(eq(salaryUploadsTable.season, key.season), eq(salaryUploadsTable.format, key.format)));
  res.set('Cache-Control', 'no-store').json(state(row));
});
router.put('/salary-files/:season/:format', async (req, res) => {
  let key;
  const body = SaveSharedSalaryFileBody.safeParse(req.body);
  try {
    key = scope(req.params.season, req.params.format);
    if (!body.success) throw new Error('Invalid salary upload.');
    validateRows(body.data.players, key.format);
  } catch (e) { res.status(400).json({ error: e instanceof Error ? e.message : 'Invalid upload.' }); return; }
  if (!body.success) return;
  const { expectedRevision, filename, players } = body.data;
  // A nonexistent record can only be created from revision zero.
  if (expectedRevision > 0) {
    const [saved] = await db.update(salaryUploadsTable).set({ filename, players, deleted: false,
      revision: sql`${salaryUploadsTable.revision} + 1`, updatedAt: new Date() })
      .where(and(eq(salaryUploadsTable.season, key.season), eq(salaryUploadsTable.format, key.format), eq(salaryUploadsTable.revision, expectedRevision))).returning();
    if (!saved) { res.status(409).json({ error: 'This salary file changed on another device. Refresh before replacing it.' }); return; }
    res.json(state(saved)); return;
  }
  const [saved] = await db.insert(salaryUploadsTable).values({ ...key, filename, players }).onConflictDoNothing().returning();
  if (!saved) { res.status(409).json({ error: 'A salary file was already uploaded on another device. Refresh to see it.' }); return; }
  res.json(state(saved));
});
router.delete('/salary-files/:season/:format', async (req, res) => {
  let key;
  const body = DeleteSharedSalaryFileBody.safeParse(req.body);
  const expectedRevision = body.success ? body.data.expectedRevision : -1;
  try {
    key = scope(req.params.season, req.params.format);
    if (!body.success) throw new Error();
  } catch { res.status(400).json({ error: 'Invalid salary deletion.' }); return; }
  const [saved] = expectedRevision === 0
    ? await db.insert(salaryUploadsTable).values({ ...key, filename: '', players: [], deleted: true }).onConflictDoNothing().returning()
    : await db.update(salaryUploadsTable).set({ deleted: true, players: [], filename: '', revision: sql`${salaryUploadsTable.revision} + 1`, updatedAt: new Date() })
      .where(and(eq(salaryUploadsTable.season, key.season), eq(salaryUploadsTable.format, key.format), eq(salaryUploadsTable.revision, expectedRevision))).returning();
  if (!saved) { res.status(409).json({ error: 'This salary file changed on another device. Refresh before removing it.' }); return; }
  res.json(state(saved));
});
export default router;
