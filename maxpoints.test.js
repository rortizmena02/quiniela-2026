// maxpoints.test.js
//
// Tests for the Max Possible Points helpers. Run with:  node --test
//
// Points must come from scoring.js (pointsForPick / totalPoints) — these tests
// also confirm best-case construction respects eliminations.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { maxForPick, maxPossible } from './maxpoints.js';

const scoring = {
  group: { correct_result: 1, exact_score: 1 },
  'Round of 32': { team_reaches: 2, correct_winner: 1, exact_score: 1 },
  'Final': { finalist_reaches: 6, correct_champion: 6, exact_score: 8 },
};

// ── (d) unplayed group pick contributes correct_result + exact_score ─────────
test('(d) unplayed group pick ceiling = correct_result + exact_score', () => {
  const pick = { round: 'Group A', src_row: 6, team1: 'Mexico', team2: 'South Africa', score1: 2, score2: 0, winner: 'Mexico' };
  assert.equal(maxForPick(pick, new Set(), scoring), 2);
});

// ── (e) KO pick with one eliminated team: only surviving reach, no bonus ─────
test('(e) R32 pick with one eliminated team -> only surviving team_reaches, zero bonus', () => {
  const pick = { round: 'Round of 32', src_row: 84, team1: 'Spain', team2: 'Algeria', score1: 3, score2: 0, winner: 'Spain' };
  // Spain eliminated, Algeria alive -> 2 (Algeria reach) + 0 bonus
  assert.equal(maxForPick(pick, new Set(['Spain']), scoring), 2);
  // sanity: both alive -> full 2 + 2 + 1 + 1 = 6
  assert.equal(maxForPick(pick, new Set(), scoring), 6);
  // other one eliminated -> 2 (Spain reach) only
  assert.equal(maxForPick(pick, new Set(['Algeria']), scoring), 2);
});

// shared fixtures for (f) / (g)
const groupResults = {
  '6': { team1: 'Mexico', team2: 'South Africa', score1: 2, score2: 0, winner: 'Mexico', final: true },
  '7': { team1: 'Rep. of Korea', team2: 'Czech Rep.', score1: 2, score2: 1, winner: 'Rep. of Korea', final: true },
  '8': { team1: 'Brazil', team2: 'Morocco', score1: 1, score2: 0, winner: 'Brazil', final: true },
};
const gp = (src, t1, t2, s1, s2, w) => ({ round: 'Group A', src_row: src, team1: t1, team2: t2, score1: s1, score2: s2, winner: w });

const leader = { alias: 'Leader', name: 'Leader', champion: 'Spain', picks: [
  gp(6, 'Mexico', 'South Africa', 2, 0, 'Mexico'),       // exact -> 2
  gp(7, 'Rep. of Korea', 'Czech Rep.', 2, 1, 'Rep. of Korea'), // exact -> 2
  gp(8, 'Brazil', 'Morocco', 1, 0, 'Brazil'),            // exact -> 2
] };
const laggard = { alias: 'Laggard', name: 'Laggard', champion: 'Spain', picks: [
  gp(6, 'Mexico', 'South Africa', 0, 1, 'South Africa'), // wrong -> 0
  gp(7, 'Rep. of Korea', 'Czech Rep.', 0, 1, 'Czech Rep.'), // wrong -> 0
  gp(8, 'Brazil', 'Morocco', 0, 1, 'Morocco'),           // wrong -> 0
  gp(9, 'France', 'Jordan', 3, 0, 'France'),             // unplayed -> ceiling +2
] };
const entrants = [leader, laggard];

// ── (f) maxPossible >= lockedIn for every entrant ───────────────────────────
test('(f) maxPossible >= lockedIn for every entrant', () => {
  const elim = new Set();
  for (const e of entrants) {
    const { lockedIn, maxPossible: mp } = maxPossible(e, groupResults, scoring, elim);
    assert.ok(mp >= lockedIn, `${e.alias}: ${mp} >= ${lockedIn}`);
  }
});

// ── (g) flagged "can't catch leader" iff maxPossible < max(lockedIn) ────────
test("(g) entrant flagged can't-catch iff maxPossible < max(lockedIn)", () => {
  const elim = new Set();
  const rows = entrants.map(e => ({ e, ...maxPossible(e, groupResults, scoring, elim) }));
  const leaderLocked = rows.reduce((mx, x) => Math.max(mx, x.lockedIn), 0);

  const byAlias = Object.fromEntries(rows.map(x => [x.e.alias, x]));
  assert.equal(byAlias.Leader.lockedIn, 6);
  assert.equal(byAlias.Leader.maxPossible, 6);   // no unplayed picks
  assert.equal(byAlias.Laggard.lockedIn, 0);
  assert.equal(byAlias.Laggard.maxPossible, 2);  // one unplayed group pick

  assert.equal(leaderLocked, 6);
  // flag = maxPossible < leaderLocked
  assert.equal(byAlias.Laggard.maxPossible < leaderLocked, true);   // flagged
  assert.equal(byAlias.Leader.maxPossible < leaderLocked, false);   // not flagged
});
