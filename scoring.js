// scoring.js — pointsForPick(pick, actual, scoring)
//
// pick   : entrant prediction { round, team1, team2, score1, score2, winner }
// actual : real result or null; knockout rounds include actual.reached (Set/Array)
// scoring: the `scoring` block from quiniela_brackets_v4.json

export function pointsForPick(pick, actual, scoring) {
  if (!actual) return 0;
  if (pick.score1 === null || pick.score2 === null || pick.winner === null) return 0;

  const round = pick.round;

  // ── Group stage ────────────────────────────────────────────────────────────
  if (round.startsWith('Group ')) {
    const sc = scoring.group;
    const correctResult = resultOf(pick) === resultOf(actual);
    if (!correctResult) return 0;
    const exactScore = pick.score1 === actual.score1 && pick.score2 === actual.score2;
    return sc.correct_result + (exactScore ? sc.exact_score : 0);
  }

  // ── Third place ─────────────────────────────────────────────────────────────
  if (round === 'Third place') {
    const sc = scoring['Third place'];
    return pick.winner === actual.winner ? sc.correct_winner : 0;
  }

  // ── Final ───────────────────────────────────────────────────────────────────
  if (round === 'Final') {
    const sc = scoring['Final'];
    const reached = toSet(actual.reached);
    const t1Reached = reached.has(pick.team1);
    const t2Reached = reached.has(pick.team2);
    let pts = 0;
    if (t1Reached) pts += sc.finalist_reaches;
    if (t2Reached) pts += sc.finalist_reaches;
    if (t1Reached && t2Reached) {
      if (pick.winner === actual.winner) pts += sc.correct_champion;
      const exactScore = pick.score1 === actual.score1 && pick.score2 === actual.score2;
      if (exactScore) pts += sc.exact_score;
    }
    return pts;
  }

  // ── Knockout (R32 / R16 / QF / SF) ─────────────────────────────────────────
  const sc = scoring[round];
  if (!sc) return 0;

  const reached = toSet(actual.reached);
  const t1Reached = reached.has(pick.team1);
  const t2Reached = reached.has(pick.team2);
  let pts = 0;
  if (t1Reached) pts += sc.team_reaches;
  if (t2Reached) pts += sc.team_reaches;

  // Winner / exact bonus only when the predicted matchup is the actual matchup
  const correctMatchup =
    pick.team1 === actual.team1 && pick.team2 === actual.team2;

  if (correctMatchup) {
    if (pick.winner === actual.winner) pts += sc.correct_winner;
    const exactScore = pick.score1 === actual.score1 && pick.score2 === actual.score2;
    if (exactScore) pts += sc.exact_score;
  }

  return pts;
}

// points for a whole entrant across all results
export function totalPoints(entrant, results, scoring) {
  let total = 0;
  for (const pick of entrant.picks) {
    const actual = results[String(pick.src_row)];
    if (actual && actual.final) {
      total += pointsForPick(pick, actual, scoring);
    }
  }
  return total;
}

// ── helpers ──────────────────────────────────────────────────────────────────
function resultOf(match) {
  if (match.score1 > match.score2) return 'team1';
  if (match.score2 > match.score1) return 'team2';
  return 'draw';
}

function toSet(reached) {
  if (!reached) return new Set();
  if (reached instanceof Set) return reached;
  return new Set(reached);
}
