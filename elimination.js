// elimination.js
//
//   eliminatedTeams(DATA) -> Set<string> of team names known to be OUT.
//
// SAFETY CONTRACT: unknown means ALIVE. A team is only added to the set when
// there is positive evidence it is out. If status can't be determined, the team
// is left out of the set (treated as alive). Wrongly reporting someone as
// eliminated is the worst possible bug, so every branch defaults to "alive".
//
// Team names are compared exactly as they appear in picks / results. Results are
// written (by fetch_results.js) using the same canonical pick names
// (e.g. "Rep. of Korea", "IR Iran"), so no extra normalization is needed here.

const KO_ROUNDS = new Set([
  'Round of 32', 'Round of 16', 'Quarter-final', 'Semi-final', 'Third place', 'Final',
]);

export function eliminatedTeams(DATA) {
  const out = new Set();
  if (!DATA || !Array.isArray(DATA.entrants) || !DATA.entrants[0]) return out;

  const picks0 = DATA.entrants[0].picks || [];
  const results = DATA.results || {};

  // src_row -> round (positions are stable across brackets)
  const roundOf = {};
  for (const p of picks0) roundOf[p.src_row] = p.round;

  // ── Rule 1: knockout losers (final results only) ──────────────────────────
  const reachedUnion = new Set();
  for (const [sr, res] of Object.entries(results)) {
    if (!res || res.final !== true) continue;
    if (!KO_ROUNDS.has(roundOf[sr])) continue;

    if (Array.isArray(res.reached)) for (const t of res.reached) reachedUnion.add(t);

    const { team1, team2, winner } = res;
    // only eliminate when the winner is unambiguously one of the two teams
    if (team1 && team2 && (winner === team1 || winner === team2)) {
      out.add(winner === team1 ? team2 : team1);
    }
    // ambiguous winner => eliminate nobody (alive default)
  }

  // ── Rule 2: group stage complete -> non-qualifiers are out ────────────────
  const groupPicks = picks0.filter(p => typeof p.round === 'string' && p.round.startsWith('Group '));
  const groupSrcRows = groupPicks.map(p => p.src_row);
  const groupComplete =
    groupSrcRows.length > 0 &&
    groupSrcRows.every(sr => results[String(sr)] && results[String(sr)].final === true);

  if (groupComplete) {
    // teams + src_rows per group label
    const groupTeams = new Map();    // label -> Set<team>
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

    // Qualified set: prefer the reached set from KO results (definitive), then
    // fill from group standings (top 2 per group + best third-placed teams).
    const qualified = new Set(reachedUnion);
    const thirds = [];
    for (const [label, teamsSet] of groupTeams) {
      const matches = groupSrcByLabel.get(label).map(sr => results[String(sr)]);
      const table = standingsForGroup([...teamsSet], matches);
      if (table[0]) qualified.add(table[0].team);
      if (table[1]) qualified.add(table[1].team);
      if (table[2]) thirds.push(table[2]);
    }
    const need = Math.max(0, qualifiedCount - qualified.size);
    thirds
      .sort(rankCmp)
      .slice(0, need)
      .forEach(t => qualified.add(t.team));

    for (const [, teamsSet] of groupTeams) {
      for (const t of teamsSet) if (!qualified.has(t)) out.add(t);
    }
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
