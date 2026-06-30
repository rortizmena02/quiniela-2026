// elimination.test.js
//
// Tests for the shared elimination helper. Run with:  node --test
//
// Safety-critical invariant: a team is only "out" with positive evidence;
// unknown status must always be treated as alive.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { eliminatedTeams, qualifiedTeams } from './elimination.js';

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

// ── (FIX 1 regression) best-third berths must not shrink because a third-placed
//    qualifier already appears in a played knockout result ─────────────────────
// Two complete groups; qualifiedCount = 6 (3 R32 picks) => top-2 each (4) + 2
// best thirds. One third-placed team (A3) also appears in a played R32 result,
// which previously made `need` one too small and dropped the other third (B3).
test('(FIX1) a best-third qualifier already seen in a KO result does not drop another third', () => {
  const res = (t1, t2, a, b, final = true) => ({
    team1: t1, team2: t2, score1: a, score2: b, winner: a > b ? t1 : b > a ? t2 : 'Draw', final,
  });
  // group of 4, ranked T1>T2>T3>T4 via T1 wins all, T2 beats T3/T4, T3 beats T4
  const groupPicks = (g, base) => ([
    { src_row: base + 0, round: g, team1: `${g}1`, team2: `${g}2` },
    { src_row: base + 1, round: g, team1: `${g}1`, team2: `${g}3` },
    { src_row: base + 2, round: g, team1: `${g}1`, team2: `${g}4` },
    { src_row: base + 3, round: g, team1: `${g}2`, team2: `${g}3` },
    { src_row: base + 4, round: g, team1: `${g}2`, team2: `${g}4` },
    { src_row: base + 5, round: g, team1: `${g}3`, team2: `${g}4` },
  ]);
  const groupResults = (g, base) => ({
    [base + 0]: res(`${g}1`, `${g}2`, 1, 0), [base + 1]: res(`${g}1`, `${g}3`, 1, 0),
    [base + 2]: res(`${g}1`, `${g}4`, 1, 0), [base + 3]: res(`${g}2`, `${g}3`, 1, 0),
    [base + 4]: res(`${g}2`, `${g}4`, 1, 0), [base + 5]: res(`${g}3`, `${g}4`, 1, 0),
  });
  const picks = [
    ...groupPicks('Group A', 1),
    ...groupPicks('Group B', 7),
    { src_row: 90, round: 'Round of 32', team1: 'Group A3', team2: 'Group B1' },
    { src_row: 91, round: 'Round of 32', team1: 'x', team2: 'y' },
    { src_row: 92, round: 'Round of 32', team1: 'x', team2: 'y' },
  ];
  const results = {
    ...groupResults('Group A', 1),
    ...groupResults('Group B', 7),
    // a played R32 result that seeds a third-placed team (Group A3) into the set
    '90': res('Group A3', 'Group B1', 1, 0),
  };
  const DATA = { entrants: [{ picks }], results };

  const q = qualifiedTeams(DATA);
  assert.equal(q.size, 6, 'should qualify exactly 6 (4 group winners/runners-up + 2 best thirds)');
  assert.equal(q.has('Group B3'), true, 'the other best-third (Group B3) must not be dropped');
  assert.equal(q.has('Group A3'), true);
});

// ── (FIX 1 data check) against the live data: 32 qualifiers incl. Senegal ────
// Skips automatically until the group stage is complete in the deployed JSON.
test('(FIX1 data) qualifiedTeams has 32 incl. Senegal once groups are complete', (t) => {
  let DATA;
  try {
    DATA = JSON.parse(fs.readFileSync(new URL('./quiniela_brackets_v4.json', import.meta.url), 'utf8'));
  } catch {
    return t.skip('quiniela_brackets_v4.json not found');
  }
  const picks0 = DATA.entrants[0].picks;
  const groupSrc = picks0.filter(p => typeof p.round === 'string' && p.round.startsWith('Group ')).map(p => p.src_row);
  const complete = groupSrc.length > 0 && groupSrc.every(sr => DATA.results[String(sr)] && DATA.results[String(sr)].final === true);
  if (!complete) return t.skip('group stage not complete in current data');

  const q = qualifiedTeams(DATA);
  assert.equal(q.size, 32);
  assert.equal(q.has('Senegal'), true);
});
