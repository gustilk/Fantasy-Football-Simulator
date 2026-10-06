import assert from 'node:assert/strict';
import { test } from 'node:test';
import { highScoringWeights } from './high-scoring.ts';

test('matches the +20% combined-score target without changing outcomes', () => {
  const totals = Array.from({ length: 200 }, (_, i) => 14 + i % 70);
  const original = [...totals];
  const { weights, evidence } = highScoringWeights(totals, totals.map(() => 1 / totals.length));
  assert.ok(Math.abs(evidence.adjustedTotal - evidence.baselineTotal * 1.2) < 1e-8);
  assert.ok(Math.abs(weights.reduce((a, b) => a + b, 0) - 1) < 1e-10);
  assert.ok(weights.every(n => Number.isFinite(n) && n >= 0));
  assert.deepEqual(totals, original);
  assert.ok(weights[69]! > weights[0]!);
  assert.match(evidence.warnings[0]!, /Manual/);
});

test('uses existing market-weighted expectation as baseline, without applying +20% twice', () => {
  const totals = Array.from({ length: 50 }, (_, i) => 10 + i * 2);
  const base = totals.map((_, i) => i + 1);
  const expected = totals.reduce((sum, value, i) => sum + value * base[i]!, 0) / base.reduce((a, b) => a + b, 0);
  const { evidence } = highScoringWeights(totals, base);
  assert.ok(Math.abs(evidence.baselineTotal - expected) < 1e-8);
  assert.ok(Math.abs(evidence.adjustedTotal - expected * 1.2) < 1e-8);
});

test('unreachable or flat scoring pools remain finite and disclose limited adjustment', () => {
  for (const totals of [Array(20).fill(40), [...Array(19).fill(40), 41], Array(20).fill(0)]) {
    const { weights, evidence } = highScoringWeights(totals, totals.map(() => 1 / 20));
    assert.ok(Number.isFinite(evidence.effectiveRuns));
    assert.ok(evidence.adjustedTotal <= Math.max(...totals));
    assert.ok(weights.every(Number.isFinite));
    if (evidence.targetTotal > Math.max(...totals)) assert.match(evidence.warnings.join(' '), /cannot reach/);
  }
});

test('rejects incomplete and invalid pools', () => {
  assert.throws(() => highScoringWeights([30], [1]));
  assert.throws(() => highScoringWeights(Array(20).fill(NaN), Array(20).fill(1)));
  assert.throws(() => highScoringWeights(Array(20).fill(30), Array(20).fill(-1)));
});
