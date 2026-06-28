// elimination.test.js
//
// Tests for the shared elimination helper. Run with:  node --test
//
// Safety-critical invariant: a team is only "out" with positive evidence;
// unknown status must always be treated as alive.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eliminatedTeams } from './elimination.js';

// ── (a) a team that lost a final knockout match is eliminated ────────────────
test('(a) loser of a final knockout match is eliminated; winner is not', () => {
  const DATA = {
    entrants: [{ picks: [
      { src_row: 90, round: 'Round of 32', team1: 'A', team2: 'B' },
    ] }],
    results: {
      '90': { team1: 'A', team2: 'B', score1: 1, score2: 0, winner: 'A', final: true, reached: ['A', 'B'] },
    },
  };
  const out = eliminatedTeams(DATA);
  assert.equal(out.has('B'), true);   // lost the match -> out
  assert.equal(out.has('A'), false);  // won the match -> alive
});

// ── (b) a team with no result yet is NOT eliminated (alive) ──────────────────
test('(b) a team with no result yet is alive', () => {
  const DATA = {
    entrants: [{ picks: [
      { src_row: 90, round: 'Round of 32', team1: 'A', team2: 'B' },
      { src_row: 91, round: 'Round of 32', team1: 'C', team2: 'D' }, // no result
    ] }],
    results: {
      '90': { team1: 'A', team2: 'B', score1: 1, score2: 0, winner: 'A', final: true, reached: ['A', 'B'] },
    },
  };
  const out = eliminatedTeams(DATA);
  assert.equal(out.has('C'), false);
  assert.equal(out.has('D'), false);
  assert.equal(out.has('A'), false);
});

// ── (c) a group team that didn't qualify is eliminated ONLY once the ────────
//        group stage is complete
function groupDATA(allFinal) {
  // One group (A,B,C,D), 6 matches; A wins all, B beats C/D, C beats D, D loses all.
  const picks = [
    { src_row: 1, round: 'Group A', team1: 'A', team2: 'B' },
    { src_row: 2, round: 'Group A', team1: 'A', team2: 'C' },
    { src_row: 3, round: 'Group A', team1: 'A', team2: 'D' },
    { src_row: 4, round: 'Group A', team1: 'B', team2: 'C' },
    { src_row: 5, round: 'Group A', team1: 'B', team2: 'D' },
    { src_row: 6, round: 'Group A', team1: 'C', team2: 'D' },
    { src_row: 90, round: 'Round of 32', team1: 'A', team2: 'B' }, // sets qualifiedCount = 2
  ];
  const res = (s, t1, t2, a, b, final) => ({
    team1: t1, team2: t2, score1: a, score2: b,
    winner: a > b ? t1 : b > a ? t2 : 'Draw', final,
  });
  const results = {
    '1': res('1', 'A', 'B', 1, 0, true),
    '2': res('2', 'A', 'C', 1, 0, true),
    '3': res('3', 'A', 'D', 1, 0, true),
    '4': res('4', 'B', 'C', 1, 0, true),
    '5': res('5', 'B', 'D', 1, 0, true),
    '6': res('6', 'C', 'D', 1, 0, allFinal), // last match: final only in the "complete" case
  };
  return { entrants: [{ picks }], results };
}

test('(c) non-qualifiers are eliminated once the group stage is complete', () => {
  const out = eliminatedTeams(groupDATA(true));
  assert.equal(out.has('C'), true);   // 3rd, no third-place slots here -> out
  assert.equal(out.has('D'), true);   // 4th -> out
  assert.equal(out.has('A'), false);  // 1st -> qualified
  assert.equal(out.has('B'), false);  // 2nd -> qualified
});

test('(c) non-qualifiers are NOT eliminated while the group stage is incomplete', () => {
  const out = eliminatedTeams(groupDATA(false)); // one group match not final
  assert.equal(out.has('C'), false);  // status unknown -> alive
  assert.equal(out.has('D'), false);  // status unknown -> alive
});
