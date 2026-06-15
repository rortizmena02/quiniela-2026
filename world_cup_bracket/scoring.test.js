// scoring.test.js
//
// Contract tests for the scoring engine. Run with:  node --test
//
// They define the expected behavior of a function the agent will implement in scoring.js:
//
//   pointsForPick(pick, actual, scoring) -> number
//
//   pick   : an entrant's prediction object from quiniela_brackets_v4.json
//            { round, src_row, team1, team2, score1, score2, winner, ... }
//   actual : the real result for this slot, or null if the match has not been played.
//            Group/Final/Third: { team1, team2, score1, score2, winner }
//            Knockout reach points additionally need the set of teams that actually reached
//            this round, passed as actual.reached (a Set or array of team names).
//   scoring: the `scoring` block from the JSON.
//
// A null `actual` (unplayed match) must always score 0.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pointsForPick } from './scoring.js';

const scoring = {
  group: { correct_result: 1, exact_score: 1 },
  'Round of 32': { team_reaches: 2, correct_winner: 1, exact_score: 1 },
  'Final': { finalist_reaches: 6, correct_champion: 6, exact_score: 8 },
};

// ---- Group stage -----------------------------------------------------------
// Real result used here: match src_row 6 = Mexico 2–0 South Africa.
const mexSa = { team1: 'Mexico', team2: 'South Africa', score1: 2, score2: 0, winner: 'Mexico' };

test('group: exact score scores result + exact (2 pts)', () => {
  const pick = { round: 'Group A', src_row: 6, team1: 'Mexico', team2: 'South Africa', score1: 2, score2: 0, winner: 'Mexico' };
  assert.equal(pointsForPick(pick, mexSa, scoring), 2);
});

test('group: right result, wrong score scores 1 pt', () => {
  const pick = { round: 'Group A', src_row: 6, team1: 'Mexico', team2: 'South Africa', score1: 3, score2: 1, winner: 'Mexico' };
  assert.equal(pointsForPick(pick, mexSa, scoring), 1);
});

test('group: wrong result (predicted draw) scores 0', () => {
  const pick = { round: 'Group A', src_row: 6, team1: 'Mexico', team2: 'South Africa', score1: 2, score2: 2, winner: 'Draw' };
  assert.equal(pointsForPick(pick, mexSa, scoring), 0);
});

test('group: wrong result (predicted away win) scores 0', () => {
  const pick = { round: 'Group A', src_row: 6, team1: 'Mexico', team2: 'South Africa', score1: 1, score2: 2, winner: 'South Africa' };
  assert.equal(pointsForPick(pick, mexSa, scoring), 0);
});

test('blank pick (null scores) always scores 0', () => {
  const pick = { round: 'Group J', src_row: 70, team1: 'Austria', team2: 'Jordan', score1: null, score2: null, winner: null };
  const actual = { team1: 'Austria', team2: 'Jordan', score1: 1, score2: 0, winner: 'Austria' };
  assert.equal(pointsForPick(pick, actual, scoring), 0);
});

test('unplayed match (null actual) always scores 0', () => {
  const pick = { round: 'Group A', src_row: 6, team1: 'Mexico', team2: 'South Africa', score1: 2, score2: 0, winner: 'Mexico' };
  assert.equal(pointsForPick(pick, null, scoring), 0);
});

// ---- Final -----------------------------------------------------------------
// Actual final: France beat Portugal 2–1, France champion.
const actualFinal = { team1: 'France', team2: 'Portugal', score1: 2, score2: 1, winner: 'France', reached: ['France', 'Portugal'] };

test('final: both finalists + champion + exact score = 26 pts', () => {
  const pick = { round: 'Final', src_row: 126, team1: 'France', team2: 'Portugal', score1: 2, score2: 1, winner: 'France' };
  // 6 (France reached) + 6 (Portugal reached) + 6 (champion) + 8 (exact) = 26
  assert.equal(pointsForPick(pick, actualFinal, scoring), 26);
});

test('final: one finalist right, wrong champion, no exact = 6 pts', () => {
  // Predicted Portugal to beat Germany; only Portugal actually reached the final.
  const pick = { round: 'Final', src_row: 126, team1: 'Portugal', team2: 'Germany', score1: 3, score2: 2, winner: 'Portugal' };
  // 6 (Portugal reached) + 0 (Germany did not) + 0 (champion wrong) + 0 (exact gated on both finalists) = 6
  assert.equal(pointsForPick(pick, actualFinal, scoring), 6);
});

// ---- Knockout reach + matchup gating --------------------------------------
// Round of 32. Actual teams that reached R32 include the two below; the actual slot
// result is Spain 3–0 Algeria, Spain through.
const actualR32 = {
  team1: 'Spain', team2: 'Algeria', score1: 3, score2: 0, winner: 'Spain',
  reached: ['Spain', 'Algeria', 'France', 'Germany'],
};

test('R32: both predicted teams reached + correct matchup + winner + exact', () => {
  const pick = { round: 'Round of 32', src_row: 84, team1: 'Spain', team2: 'Algeria', score1: 3, score2: 0, winner: 'Spain' };
  // 2 + 2 (both reached) + 1 (winner, matchup correct) + 1 (exact) = 6
  assert.equal(pointsForPick(pick, actualR32, scoring), 6);
});

test('R32: reach points awarded per team even when matchup is wrong', () => {
  // Predicted France vs Algeria here. Both reached the round, but this was not the actual matchup,
  // so winner/exact bonuses are NOT awarded — only reach points.
  const pick = { round: 'Round of 32', src_row: 84, team1: 'France', team2: 'Algeria', score1: 2, score2: 1, winner: 'France' };
  // 2 (France reached) + 2 (Algeria reached) + 0 + 0 = 4
  assert.equal(pointsForPick(pick, actualR32, scoring), 4);
});
