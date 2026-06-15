// whatif.js
//
// Helpers for the "What-If" view. All point values come from scoring.js
// (pointsForPick / totalPoints) — no scoring rules are reimplemented here.
//
//   hypotheticalActual(match, outcome) -> a synthetic `actual` object in the
//       same shape pointsForPick consumes, with final:true, so a not-yet-played
//       match can be scored as if it had finished.
//
//   projectTotals(entrants, results, scoring) -> [{ entrant, points }]
//       each entrant's total over a results map, via totalPoints in scoring.js.

import { totalPoints } from './scoring.js';

// match   : { team1, team2 }  (a fixed group fixture)
// outcome : either { score1, score2 }  (exact score; winner derived)
//           or     { winner }          (winner only: 'team1 name' | 'team2 name' | 'Draw')
//
// For a winner-only hypothetical we synthesize an impossible exact score with
// the correct result orientation, so pointsForPick awards the correct-result
// point but never a spurious exact-score bonus to anyone.
export function hypotheticalActual(match, outcome) {
  const { team1, team2 } = match;

  if (outcome && outcome.score1 != null && outcome.score2 != null) {
    const s1 = outcome.score1, s2 = outcome.score2;
    const winner = s1 > s2 ? team1 : s2 > s1 ? team2 : 'Draw';
    return { team1, team2, score1: s1, score2: s2, winner, final: true };
  }

  const w = outcome && outcome.winner;
  if (w === team1) return { team1, team2, score1: 99, score2: 0, winner: team1, final: true };
  if (w === team2) return { team1, team2, score1: 0, score2: 99, winner: team2, final: true };
  // draw
  return { team1, team2, score1: 99, score2: 99, winner: 'Draw', final: true };
}

export function projectTotals(entrants, results, scoring) {
  return entrants.map(entrant => ({
    entrant,
    points: totalPoints(entrant, results, scoring),
  }));
}
