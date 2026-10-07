import { Router, type IRouter } from 'express';
import { and, eq, sql } from 'drizzle-orm';
import { db, manualPicksTable, salaryUploadsTable } from '@workspace/db';
import { GetSharedManualPicksBody, GetSharedManualPicksParams, SaveSharedManualPicksBody, SaveSharedManualPicksParams } from '@workspace/api-zod';
import { contestKey, contestSignature, picksState } from '../lib/manual-picks';

const router: IRouter = Router();
router.post('/manual-picks/:season/lookup', async (req, res): Promise<void> => {
  const params = GetSharedManualPicksParams.safeParse(req.params);
  const body = GetSharedManualPicksBody.safeParse(req.body);
  if (!params.success || !body.success) { res.status(400).json({ error: 'Invalid contest lookup.' }); return; }
  let key;
  try { key = contestKey(body.data.signature); }
  catch { res.status(400).json({ error: 'Invalid contest fingerprint.' }); return; }
  const [row] = await db.select().from(manualPicksTable).where(and(
    eq(manualPicksTable.season, params.data.season), eq(manualPicksTable.contestHash, key.contestHash)));
  res.set('Cache-Control', 'no-store').json(picksState(body.data.signature, row));
});
router.put('/manual-picks/:season', async (req, res): Promise<void> => {
  const params = SaveSharedManualPicksParams.safeParse(req.params);
  const body = SaveSharedManualPicksBody.safeParse(req.body);
  if (!params.success || !body.success) { res.status(400).json({ error: 'Invalid manual picks.' }); return; }
  const { signature, expectedRevision, picks } = body.data;
  let key;
  try {
    key = contestKey(signature);
    const seen = new Set<string>();
    for (const p of picks) {
      if (!key.ids.has(p.id) || seen.has(p.id)) throw new Error();
      seen.add(p.id);
    }
  } catch { res.status(400).json({ error: 'Picks must contain unique IDs from this exact contest.' }); return; }
  const season = params.data.season;
  const where = and(eq(manualPicksTable.season, season), eq(manualPicksTable.contestHash, key.contestHash));
  const response = await db.transaction(async tx => {
    // Serialize salary replacement with this save: an old device cannot save
    // against a contest that has ceased to be the active Classic upload.
    const [salary] = await tx.select().from(salaryUploadsTable).where(and(
      eq(salaryUploadsTable.season, season), eq(salaryUploadsTable.format, 'classic'))).for('update');
    if (!salary || salary.deleted || contestSignature(salary.players as Parameters<typeof contestSignature>[0]) !== signature) return null;
    const [existing] = await tx.select().from(manualPicksTable).where(where);
    // Validate stored data before writing: never "repair" corruption by overwriting it.
    picksState(signature, existing);
    const [saved] = expectedRevision === 0
      ? await tx.insert(manualPicksTable).values({ season, contestHash: key.contestHash, signature, picks }).onConflictDoNothing().returning()
      : await tx.update(manualPicksTable).set({ picks, revision: sql`${manualPicksTable.revision} + 1`, updatedAt: new Date() })
        .where(and(where, eq(manualPicksTable.revision, expectedRevision))).returning();
    return saved ? picksState(signature, saved) : null;
  });
  if (!response) { res.status(409).json({ error: 'Shared picks or Classic salaries changed. Your browser draft is intact. Refresh before saving.' }); return; }
  res.json(response);
});
export default router;
