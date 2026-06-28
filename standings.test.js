// standings.test.js
//
// Tests for the reach-aware live total. Run with:  node --test
//
// The bug these guard against: Round-of-32 "reach" points were not credited for
// teams that had already qualified (because the plain totalPoints only scores a
// pick whose own slot match is final). liveTotal must credit reach as soon as the
// participants are known, while still gating winner/exact bonuses on a final match.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reachedByRound, liveTotal } from './standings.js';

const scoring = {
  group: { correct_result: 1, exact_score: 1 },
  'Round of 32': { team_reaches: 2, correct_winner: 1, exact_score: 1 },
};

// One group (A>B>C>D): A & B qualify (top 2, since qualifiedCount = 2), C & D out.
// The entrant's single R32 pick and an optional actual R32 result are configurable.
function buildDATA({ allFinal = true, r32 = { t1: 'A', t2: 'C', s1: 1, s2: 0, w: 'A' }, r32Result = null } = {}) {
  const res = (t1, t2, a, b, final = true) => ({
    team1: t1, team2: t2, score1: a, score2: b,
    winner: a > b ? t1 : b > a ? t2 : 'Draw', final,
  });
  const blank = (src, t1, t2) => ({ src_row: src, round: 'Group A', team1: t1, team2: t2, score1: null, score2: null, winner: null });
  const picks = [
    blank(1, 'A', 'B'), blank(2, 'A', 'C'), blank(3, 'A', 'D'),
    blank(4, 'B', 'C'), blank(5, 'B', 'D'), blank(6, 'C', 'D'),
    { src_row: 90, round: 'Round of 32', team1: r32.t1, team2: r32.t2, score1: r32.s1, score2: r32.s2, winner: r32.w },
  ];
  const results = {
    '1': res('A', 'B', 1, 0), '2': res('A', 'C', 1, 0), '3': res('A', 'D', 1, 0),
    '4': res('B', 'C', 1, 0), '5': res('B', 'D', 1, 0), '6': res('C', 'D', 1, 0, allFinal),
  };
  if (r32Result) results['90'] = r32Result;
  return { entrants: [{ alias: 'E', name: 'E', picks }], results };
}

test('reachedByRound: R32 = group qualifiers once the group stage is complete', () => {
  const reached = reachedByRound(buildDATA());
  assert.equal(reached['Round of 32'].has('A'), true);
  assert.equal(reached['Round of 32'].has('B'), true);
  assert.equal(reached['Round of 32'].has('C'), false);
  assert.equal(reached['Round of 32'].has('D'), false);
});

test('liveTotal credits R32 reach for a qualified team with NO R32 match yet', () => {
  // pick A (qualified, +2) vs C (out, 0); no bonus since slot not final => 2
  assert.equal(liveTotal(buildDATA().entrants[0], buildDATA(), scoring), 2);
});

test('liveTotal credits reach for BOTH predicted teams when both qualified', () => {
  const DATA = buildDATA({ r32: { t1: 'A', t2: 'B', s1: 1, s2: 0, w: 'A' } });
  // A (+2) + B (+2), no bonus (slot not final) => 4
  assert.equal(liveTotal(DATA.entrants[0], DATA, scoring), 4);
});

test('liveTotal does NOT credit R32 reach while the group stage is incomplete', () => {
  const DATA = buildDATA({ allFinal: false });
  assert.equal(liveTotal(DATA.entrants[0], DATA, scoring), 0);
});

test('liveTotal adds winner/exact bonus once the R32 match is final & matches', () => {
  const DATA = buildDATA({
    r32: { t1: 'A', t2: 'B', s1: 1, s2: 0, w: 'A' },
    r32Result: { team1: 'A', team2: 'B', score1: 1, score2: 0, winner: 'A', final: true },
  });
  // reach A(+2) + B(+2) + winner(+1) + exact(+1) = 6
  assert.equal(liveTotal(DATA.entrants[0], DATA, scoring), 6);
});

test('liveTotal withholds bonus when the slot is not final (reach only)', () => {
  const DATA = buildDATA({ r32: { t1: 'A', t2: 'B', s1: 1, s2: 0, w: 'A' } });
  // even though the pick "would" be a perfect A-beats-B, no match result => reach only (4)
  assert.equal(liveTotal(DATA.entrants[0], DATA, scoring), 4);
});
