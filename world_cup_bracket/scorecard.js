// scorecard.js
//
// Per-pick scorecard state used by the per-person bracket view.
//
//   scoreCard(pick, actual, scoring) -> { state, points }
//     state  : 'correct' | 'wrong' | 'unplayed'
//     points : number when the match is final, otherwise null
//
// The point value is delegated entirely to pointsForPick in scoring.js — this
// module does NOT reimplement any scoring rules. Only matches marked `final`
// are scored; unplayed (or in-progress) matches return { state: 'unplayed' }
// so the UI leaves them uncolored.

import { pointsForPick } from './scoring.js';

export function scoreCard(pick, actual, scoring) {
  if (!actual || actual.final !== true) {
    return { state: 'unplayed', points: null };
  }
  const points = pointsForPick(pick, actual, scoring);
  return { state: points > 0 ? 'correct' : 'wrong', points };
}
