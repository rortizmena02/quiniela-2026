// scorecard.test.js
//
// Tests for the per-person bracket scorecard helper (scorecard.js).
//
//   scoreCard(pick, actual, scoring) -> { state, points }
//
// The scorecard's points must come straight from pointsForPick (scoring.js);
// these tests assert that the points match pointsForPick exactly, that the
// green/red state follows from those points, and that only matches marked
// `final` are scored (unplayed/in-progress => { state:'unplayed', points:null }).
//
// Run with:  node --test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreCard } from './scorecard.js';
import { pointsForPick } from './scoring.js';

const scoring = {
  group: { correct_result: 1, exact_score: 1 },
  'Round of 32': { team_reaches: 2, correct_winner: 1, exact_score: 1 },
  'Final': { finalist_reaches: 6, correct_champion: 6, exact_score: 8 },
};

// ---- gating on `final` -----------------------------------------------------
test('scorecard: null actual (unplayed) is uncolored, no points', () => {
  const pick = { round: 'Group A', src_row: 6, team1: 'Mexico', team2: 'South Africa', score1: 2, score2: 0, winner: 'Mexico' };
  assert.deepEqual(scoreCard(pick, null, scoring), { state: 'unplayed', points: null });
});

test('scorecard: in-progress (final !== true) is uncolored, no points', () => {
  const pick = { round: 'Group A', src_row: 6, team1: 'Mexico', team2: 'South Africa', score1: 2, score2: 0, winner: 'Mexico' };
  const actual = { team1: 'Mexico', team2: 'South Africa', score1: 2, score2: 0, winner: 'Mexico', final: false, status: 'in_progress' };
  assert.deepEqual(scoreCard(pick, actual, scoring), { state: 'unplayed', points: null });
});

// ---- group: correct vs wrong ----------------------------------------------
const mexSaFinal = { team1: 'Mexico', team2: 'South Africa', score1: 2, score2: 0, winner: 'Mexico', final: true };

test('scorecard: group exact score => correct, 2 pts (matches pointsForPick)', () => {
  const pick = { round: 'Group A', src_row: 6, team1: 'Mexico', team2: 'South Africa', score1: 2, score2: 0, winner: 'Mexico' };
  const card = scoreCard(pick, mexSaFinal, scoring);
  assert.equal(card.points, pointsForPick(pick, mexSaFinal, scoring));
  assert.deepEqual(card, { state: 'correct', points: 2 });
});

test('scorecard: group right result wrong score => correct, 1 pt', () => {
  const pick = { round: 'Group A', src_row: 6, team1: 'Mexico', team2: 'South Africa', score1: 3, score2: 1, winner: 'Mexico' };
  assert.deepEqual(scoreCard(pick, mexSaFinal, scoring), { state: 'correct', points: 1 });
});

test('scorecard: group wrong result => wrong, 0 pts', () => {
  const pick = { round: 'Group A', src_row: 6, team1: 'Mexico', team2: 'South Africa', score1: 1, score2: 2, winner: 'South Africa' };
  assert.deepEqual(scoreCard(pick, mexSaFinal, scoring), { state: 'wrong', points: 0 });
});

test('scorecard: blank pick on a final match => wrong, 0 pts', () => {
  const pick = { round: 'Group J', src_row: 70, team1: 'Austria', team2: 'Jordan', score1: null, score2: null, winner: null };
  const actual = { team1: 'Austria', team2: 'Jordan', score1: 1, score2: 0, winner: 'Austria', final: true };
  assert.deepEqual(scoreCard(pick, actual, scoring), { state: 'wrong', points: 0 });
});

// ---- knockout: reach + matchup --------------------------------------------
const actualR32 = {
  team1: 'Spain', team2: 'Algeria', score1: 3, score2: 0, winner: 'Spain', final: true,
  reached: ['Spain', 'Algeria', 'France', 'Germany'],
};

test('scorecard: R32 perfect slot => correct, 6 pts (matches pointsForPick)', () => {
  const pick = { round: 'Round of 32', src_row: 84, team1: 'Spain', team2: 'Algeria', score1: 3, score2: 0, winner: 'Spain' };
  const card = scoreCard(pick, actualR32, scoring);
  assert.equal(card.points, pointsForPick(pick, actualR32, scoring));
  assert.deepEqual(card, { state: 'correct', points: 6 });
});

test('scorecard: R32 reach-only (wrong matchup) => correct, 4 pts', () => {
  const pick = { round: 'Round of 32', src_row: 84, team1: 'France', team2: 'Algeria', score1: 2, score2: 1, winner: 'France' };
  assert.deepEqual(scoreCard(pick, actualR32, scoring), { state: 'correct', points: 4 });
});

test('scorecard: R32 neither team reached => wrong, 0 pts', () => {
  const actual = { team1: 'Spain', team2: 'Algeria', score1: 3, score2: 0, winner: 'Spain', final: true, reached: ['Spain', 'Algeria'] };
  const pick = { round: 'Round of 32', src_row: 84, team1: 'Brazil', team2: 'Japan', score1: 1, score2: 0, winner: 'Brazil' };
  assert.deepEqual(scoreCard(pick, actual, scoring), { state: 'wrong', points: 0 });
});

// ---- final ----------------------------------------------------------------
const actualFinal = { team1: 'France', team2: 'Portugal', score1: 2, score2: 1, winner: 'France', final: true, reached: ['France', 'Portugal'] };

test('scorecard: final perfect => correct, 26 pts (matches pointsForPick)', () => {
  const pick = { round: 'Final', src_row: 126, team1: 'France', team2: 'Portugal', score1: 2, score2: 1, winner: 'France' };
  const card = scoreCard(pick, actualFinal, scoring);
  assert.equal(card.points, pointsForPick(pick, actualFinal, scoring));
  assert.deepEqual(card, { state: 'correct', points: 26 });
});
