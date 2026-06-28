// elimination.js
//
//   eliminatedTeams(DATA) -> Set<string> of team names known to be OUT.
//   qualifiedTeams(DATA)  -> Set<string> of teams that have provably reached the
//                            Round of 32 (group qualifiers, once groups complete,
//                            plus any team already seen in a knockout result).
//
// SAFETY CONTRACT: unknown means ALIVE / not-yet-known. A team is only added to
// the eliminated set with positive evidence. Wrongly reporting someone as
// eliminated is the worst possible bug, so every branch defaults to "alive".
//
// Team names are compared exactly as they appear in picks / results (results are
// written using the same canonical pick names, e.g. "Rep. of Korea", "IR Iran").

const KO_ROUNDS = new Set([
  'Round of 32', 'Round of 16', 'Quarter-final', 'Semi-final', 'Third place', 'Final',
]);

function context(DATA) {
  const picks0 = (DATA && DATA.entrants && DATA.entrants[0] && DATA.entrants[0].picks) || [];
  const results = (DATA && DATA.results) || {};
  const roundOf = {};
  for (const p of picks0) roundOf[p.src_row] = p.round;
  return { picks0, results, roundOf };
}

function groupInfo(picks0, results) {
  const groupPicks = picks0.filter(p => typeof p.round === 'string' && p.round.startsWith('Group '));
  const groupSrcRows = groupPicks.map(p => p.src_row);
  const complete =
    groupSrcRows.length > 0 &&
    groupSrcRows.every(sr => results[String(sr)] && results[String(sr)].final === true);
  return { groupPicks, complete };
}

// Teams that have provably reached the Round of 32.
export function qualifiedTeams(DATA) {
  const out = new Set();
  if (!DATA || !DATA.entrants || !DATA.entrants[0]) return out;
  const { picks0, results, roundOf } = context(DATA);

  // Any team that has appeared in (or is listed in `reached` for) a knockout
  // result has, by definition, already qualified for the Round of 32.
  for (const [sr, res] of Object.entries(results)) {
    if (!res || res.final !== true || !KO_ROUNDS.has(roundOf[sr])) continue;
    if (Array.isArray(res.reached)) for (const t of res.reached) out.add(t);
    if (res.team1) out.add(res.team1);
    if (res.team2) out.add(res.team2);
  }

  // Once the group stage is complete, add the top-2 of each group plus the best
  // third-placed teams up to the number of Round-of-32 berths.
  const { groupPicks, complete } = groupInfo(picks0, results);
  if (complete) {
    const groupTeams = new Map();      // label -> Set<team>
    const groupSrcByLabel = new Map(); // label -> [src_row]
    for (const p of groupPicks) {
      if (!groupTeams.has(p.round)) { groupTeams.set(p.round, new Set()); groupSrcByLabel.set(p.round, []); }
      if (p.team1) groupTeams.get(p.round).add(p.team1);
      if (p.team2) groupTeams.get(p.round).add(p.team2);
      groupSrcByLabel.get(p.round).push(p.src_row);
    }
    const numGroups = groupTeams.size;
    const r32Count = picks0.filter(p => p.round === 'Round of 32').length;
    const qualifiedCount = r32Count > 0 ? r32Count * 2 : numGroups * 2;

    const thirds = [];
    for (const [label, teamsSet] of groupTeams) {
      const matches = groupSrcByLabel.get(label).map(sr => results[String(sr)]);
      const table = standingsForGroup([...teamsSet], matches);
      if (table[0]) out.add(table[0].team);
      if (table[1]) out.add(table[1].team);
      if (table[2]) thirds.push(table[2]);
    }
    const need = Math.max(0, qualifiedCount - out.size);
    thirds.sort(rankCmp).slice(0, need).forEach(t => out.add(t.team));
  }

  return out;
}

export function eliminatedTeams(DATA) {
  const out = new Set();
  if (!DATA || !DATA.entrants || !DATA.entrants[0]) return out;
  const { picks0, results, roundOf } = context(DATA);

  // ── Rule 1: knockout losers (final results only) ──────────────────────────
  for (const [sr, res] of Object.entries(results)) {
    if (!res || res.final !== true || !KO_ROUNDS.has(roundOf[sr])) continue;
    const { team1, team2, winner } = res;
    if (team1 && team2 && (winner === team1 || winner === team2)) {
      out.add(winner === team1 ? team2 : team1);
    }
    // ambiguous winner => eliminate nobody (alive default)
  }

  // ── Rule 2: group stage complete -> non-qualifiers are out ────────────────
  const { groupPicks, complete } = groupInfo(picks0, results);
  if (complete) {
    const qualified = qualifiedTeams(DATA);
    const groupTeams = new Set();
    for (const p of groupPicks) { if (p.team1) groupTeams.add(p.team1); if (p.team2) groupTeams.add(p.team2); }
    for (const t of groupTeams) if (!qualified.has(t)) out.add(t);
  }

  return out;
}

// ── helpers ──────────────────────────────────────────────────────────────────
// FIFA primary tiebreakers: points, then goal difference, then goals for.
// (Head-to-head, only used when those are all equal, is not applied.)
function rankCmp(a, b) {
  return b.pts - a.pts || b.gd - a.gd || b.gf - a.gf || a.team.localeCompare(b.team);
}

function standingsForGroup(teams, matches) {
  const tbl = new Map();
  for (const t of teams) tbl.set(t, { team: t, pts: 0, gf: 0, ga: 0 });
  for (const m of matches) {
    if (!m) continue;
    const a = tbl.get(m.team1), b = tbl.get(m.team2);
    if (!a || !b) continue;
    a.gf += m.score1; a.ga += m.score2;
    b.gf += m.score2; b.ga += m.score1;
    if (m.score1 > m.score2) a.pts += 3;
    else if (m.score2 > m.score1) b.pts += 3;
    else { a.pts += 1; b.pts += 1; }
  }
  return [...tbl.values()]
    .map(x => ({ ...x, gd: x.gf - x.ga }))
    .sort(rankCmp);
}
