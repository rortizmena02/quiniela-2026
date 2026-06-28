// standings.js
//
//   reachedByRound(DATA) -> { [round]: Set<team> } of teams that have provably
//       reached each knockout round.
//   liveTotal(entrant, DATA, scoring [, reached]) -> reach-aware current total.
//
// Why this exists: a team "reaches the Round of 32" by qualifying out of its
// group, which is known the moment the group stage finishes — before any R32
// match is played. The plain totalPoints() in scoring.js only scores a pick when
// that pick's own slot result is final, so it never credits reach points for
// qualified teams until the individual knockout matches are entered. liveTotal()
// fixes that: it credits each round's reach points as soon as the participants
// are known, while still requiring a final match result for the winner / exact /
// champion bonuses. All point values still come from pointsForPick (scoring.js).

import { pointsForPick } from './scoring.js';
import { qualifiedTeams } from './elimination.js';

const PREV_ROUND = {
  'Round of 16': 'Round of 32',
  'Quarter-final': 'Round of 16',
  'Semi-final': 'Quarter-final',
  'Final': 'Semi-final',
};

// sentinels that can never equal a real team name — used to deliberately break
// the matchup / champion gates so a bonus is NOT awarded before the match is final.
const NONE_1 = ' __reach_only_1__';
const NONE_2 = ' __reach_only_2__';
const NONE_W = ' __reach_only_w__';

export function reachedByRound(DATA) {
  const picks0 = (DATA && DATA.entrants && DATA.entrants[0] && DATA.entrants[0].picks) || [];
  const results = (DATA && DATA.results) || {};
  const roundOf = {};
  for (const p of picks0) roundOf[p.src_row] = p.round;

  const winnersOf = round => {
    const s = new Set();
    for (const [sr, res] of Object.entries(results)) {
      if (roundOf[sr] === round && res && res.final === true &&
          res.winner && (res.winner === res.team1 || res.winner === res.team2)) {
        s.add(res.winner);
      }
    }
    return s;
  };
  const participantsOf = round => {
    const s = new Set();
    for (const [sr, res] of Object.entries(results)) {
      if (roundOf[sr] === round && res && res.final === true) {
        if (res.team1) s.add(res.team1);
        if (res.team2) s.add(res.team2);
      }
    }
    return s;
  };

  const reached = {};
  // R32 participants = group qualifiers (known once groups complete) + anyone
  // already seen in an R32 result.
  reached['Round of 32'] = new Set([...qualifiedTeams(DATA), ...participantsOf('Round of 32')]);
  // Each later round's participants = winners of the previous round + anyone
  // already seen in that round's results.
  for (const round of ['Round of 16', 'Quarter-final', 'Semi-final', 'Final']) {
    reached[round] = new Set([...winnersOf(PREV_ROUND[round]), ...participantsOf(round)]);
  }
  return reached;
}

export function liveTotal(entrant, DATA, scoring, reached) {
  const reachedMap = reached || reachedByRound(DATA);
  const results = (DATA && DATA.results) || {};
  let total = 0;

  for (const pick of entrant.picks) {
    const round = pick.round;
    if (typeof round !== 'string') continue;
    const result = results[String(pick.src_row)];

    // Group + Third place: only score once the match is final (no reach points).
    if (round.startsWith('Group ') || round === 'Third place') {
      if (result && result.final === true) total += pointsForPick(pick, result, scoring);
      continue;
    }

    // Knockout + Final: credit reach as soon as participants are known; only add
    // winner / exact / champion bonuses when the actual match result is final.
    const reachedArr = [...(reachedMap[round] || [])];
    if (result && result.final === true) {
      total += pointsForPick(pick, { ...result, reached: reachedArr }, scoring);
    } else {
      total += pointsForPick(pick, {
        team1: NONE_1, team2: NONE_2, score1: -1, score2: -1, winner: NONE_W,
        reached: reachedArr,
      }, scoring);
    }
  }
  return total;
}
