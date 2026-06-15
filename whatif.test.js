// whatif.test.js
//
// Tests for the What-If projection helpers (whatif.js). Points must come from
// scoring.js (totalPoints / pointsForPick) applied to a synthetic `actual`
// produced by hypotheticalActual — no scoring rules are reimplemented.
//
// Run with:  node --test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hypotheticalActual, projectTotals } from './whatif.js';
import { totalPoints } from './scoring.js';

const scoring = { group: { correct_result: 1, exact_score: 1 } };

// One fixture: Mexico vs South Africa (src_row 6), not yet played.
const match = { team1: 'Mexico', team2: 'South Africa' };

// Two entrants with one pick each on src_row 6.
const exactBacker = {
  alias: 'Exact', name: 'Exact Backer',
  picks: [{ src_row: 6, round: 'Group A', team1: 'Mexico', team2: 'South Africa', score1: 2, score2: 0, winner: 'Mexico' }],
};
const resultBacker = {
  alias: 'Result', name: 'Result Backer',
  picks: [{ src_row: 6, round: 'Group A', team1: 'Mexico', team2: 'South Africa', score1: 1, score2: 0, winner: 'Mexico' }],
};
const wrongBacker = {
  alias: 'Wrong', name: 'Wrong Backer',
  picks: [{ src_row: 6, round: 'Group A', team1: 'Mexico', team2: 'South Africa', score1: 0, score2: 1, winner: 'South Africa' }],
};
const entrants = [exactBacker, resultBacker, wrongBacker];

// ── hypotheticalActual shape ────────────────────────────────────────────────
test('hypotheticalActual: exact score derives winner + final:true', () => {
  assert.deepEqual(
    hypotheticalActual(match, { score1: 2, score2: 0 }),
    { team1: 'Mexico', team2: 'South Africa', score1: 2, score2: 0, winner: 'Mexico', final: true }
  );
});

test('hypotheticalActual: winner-only uses impossible score (no exact leakage)', () => {
  const a = hypotheticalActual(match, { winner: 'Mexico' });
  assert.equal(a.winner, 'Mexico');
  assert.equal(a.final, true);
  assert.ok(a.score1 > a.score2);            // correct orientation
  assert.ok(a.score1 >= 99);                 // impossible exact score
});

// ── projection: hypothetical EXACT-score win ────────────────────────────────
test('what-if exact-score win: exact backer +2, result backer +1, wrong +0', () => {
  const merged = { '6': hypotheticalActual(match, { score1: 2, score2: 0 }) };
  const proj = projectTotals(entrants, merged, scoring);
  const pts = Object.fromEntries(proj.map(x => [x.entrant.alias, x.points]));
  assert.equal(pts.Exact, 2);   // correct result + exact score
  assert.equal(pts.Result, 1);  // correct result only
  assert.equal(pts.Wrong, 0);   // wrong result
});

// ── projection: hypothetical WINNER-ONLY (no exact bonus for anyone) ─────────
test('what-if winner-only: both Mexico backers +1, wrong +0 (no exact leakage)', () => {
  const merged = { '6': hypotheticalActual(match, { winner: 'Mexico' }) };
  const proj = projectTotals(entrants, merged, scoring);
  const pts = Object.fromEntries(proj.map(x => [x.entrant.alias, x.points]));
  assert.equal(pts.Exact, 1);   // correct result, but no spurious exact bonus
  assert.equal(pts.Result, 1);  // correct result
  assert.equal(pts.Wrong, 0);
});

// ── projection: hypothetical WRONG result flips who scores ──────────────────
test('what-if South Africa win: wrong backer +1, Mexico backers +0', () => {
  const merged = { '6': hypotheticalActual(match, { winner: 'South Africa' }) };
  const proj = projectTotals(entrants, merged, scoring);
  const pts = Object.fromEntries(proj.map(x => [x.entrant.alias, x.points]));
  assert.equal(pts.Exact, 0);
  assert.equal(pts.Result, 0);
  assert.equal(pts.Wrong, 1);
});

// ── baseline: no hypotheticals => everyone 0 (match unplayed) ───────────────
test('what-if baseline with empty results: all zero', () => {
  const proj = projectTotals(entrants, {}, scoring);
  assert.deepEqual(proj.map(x => x.points), [0, 0, 0]);
});

// ── projection matches totalPoints directly (no divergence) ─────────────────
test('projectTotals equals totalPoints per entrant', () => {
  const merged = { '6': hypotheticalActual(match, { score1: 2, score2: 0 }) };
  for (const e of entrants) {
    const direct = totalPoints(e, merged, scoring);
    const viaProj = projectTotals([e], merged, scoring)[0].points;
    assert.equal(viaProj, direct);
  }
});
