#!/usr/bin/env node
/*
 * fetch_results.js — refresh quiniela_brackets_v4.json with real World Cup 2026
 * results from football-data.org.
 *
 * USAGE
 *   FOOTBALL_DATA_API_KEY=xxxxxxxx node fetch_results.js
 *   FOOTBALL_DATA_API_KEY=xxxxxxxx node fetch_results.js --dry-run
 *   FOOTBALL_DATA_API_KEY=xxxxxxxx node fetch_results.js --file ./quiniela_brackets_v4.json
 *
 * Then re-drop the folder onto Netlify to publish.
 *
 * WHAT IT DOES
 *   - Pulls FINISHED matches for the World Cup (competition code "WC").
 *   - Group stage: matched to the correct src_row by team pairing (group
 *     fixtures are fixed across all brackets), writing score + winner.
 *   - Knockout: writes score / winner / penalties into that round's slots and
 *     recomputes the set of teams that actually reached each round (the
 *     `reached` array the scoring engine needs for "team reaches" points).
 *   - Re-runnable: only FINISHED matches are written; entrant predictions are
 *     never touched; previously-stored results are preserved.
 *
 * The `actual` objects written here match the shape consumed by pointsForPick
 * in scoring.js / scoring.test.js:
 *     group/final/third : { team1, team2, score1, score2, winner }
 *     knockout          : + reached (array), + pen1/pen2 when a shootout decided it
 *   (plus `final: true`, which the dashboard's totalPoints() requires.)
 */

'use strict';
const fs = require('fs');
const path = require('path');

// ── config ───────────────────────────────────────────────────────────────────
const API_BASE = 'https://api.football-data.org/v4';
const COMPETITION = process.env.FOOTBALL_DATA_COMPETITION || 'WC'; // World Cup
const API_KEY = process.env.FOOTBALL_DATA_API_KEY || process.env.FOOTBALL_DATA_TOKEN;

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const fileArgIdx = args.indexOf('--file');
const JSON_PATH = path.resolve(
  fileArgIdx !== -1 && args[fileArgIdx + 1] ? args[fileArgIdx + 1] : './quiniela_brackets_v4.json'
);

// football-data stage code -> quiniela round label
const STAGE_TO_ROUND = {
  GROUP_STAGE: 'GROUP',
  LAST_32: 'Round of 32',
  ROUND_OF_32: 'Round of 32',
  LAST_16: 'Round of 16',
  ROUND_OF_16: 'Round of 16',
  QUARTER_FINALS: 'Quarter-final',
  QUARTER_FINAL: 'Quarter-final',
  SEMI_FINALS: 'Semi-final',
  SEMI_FINAL: 'Semi-final',
  THIRD_PLACE: 'Third place',
  FINAL: 'Final',
};
const KO_ROUNDS = ['Round of 32', 'Round of 16', 'Quarter-final', 'Semi-final', 'Final'];

// API team name -> quiniela canonical name (only the non-obvious ones).
// Matching first tries an exact normalized comparison against the names already
// in your JSON, then falls back to this alias table.
const TEAM_ALIASES = {
  'korea republic': 'Rep. of Korea',
  'south korea': 'Rep. of Korea',
  'republic of korea': 'Rep. of Korea',
  'czechia': 'Czech Rep.',
  'czech republic': 'Czech Rep.',
  'bosnia and herzegovina': 'Bosnia/Herzeg.',
  'bosnia herzegovina': 'Bosnia/Herzeg.',
  'iran': 'IR Iran',
  'islamic republic of iran': 'IR Iran',
  'turkiye': 'Turkey',
  'united states': 'USA',
  'united states of america': 'USA',
  'usmnt': 'USA',
  'cote divoire': 'Ivory Coast',
  'ivory coast': 'Ivory Coast',
  'china pr': 'China',
};

// ── helpers ────────────────────────────────────────────────────────────────
function die(msg) { console.error('✗ ' + msg); process.exit(1); }

function normName(s) {
  return String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // strip diacritics
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// build a resolver from API name -> canonical quiniela name
function makeResolver(canonicalNames) {
  const byNorm = new Map();
  for (const name of canonicalNames) byNorm.set(normName(name), name);
  return function resolve(apiName) {
    const n = normName(apiName);
    if (byNorm.has(n)) return byNorm.get(n);
    if (TEAM_ALIASES[n]) {
      const alias = TEAM_ALIASES[n];
      // alias may itself need normalizing against canonical set
      return byNorm.get(normName(alias)) || alias;
    }
    return null; // unresolved
  };
}

function apiWinnerToName(score, homeName, awayName) {
  switch (score && score.winner) {
    case 'HOME_TEAM': return homeName;
    case 'AWAY_TEAM': return awayName;
    case 'DRAW': return 'Draw';
    default: return null;
  }
}

async function fetchMatches() {
  if (typeof fetch !== 'function') {
    die('global fetch() not available — please use Node 18+ (node --version).');
  }
  const url = `${API_BASE}/competitions/${COMPETITION}/matches`;
  const res = await fetch(url, { headers: { 'X-Auth-Token': API_KEY } });
  if (res.status === 403 || res.status === 429) {
    const body = await res.text().catch(() => '');
    die(`football-data.org returned ${res.status}. The free tier may not cover ` +
        `competition "${COMPETITION}". ${body}\n` +
        `If the World Cup isn't available on your plan, tell me and I'll switch ` +
        `the script to another free source (e.g. TheSportsDB / API-Football free tier).`);
  }
  if (!res.ok) die(`API error ${res.status}: ${await res.text().catch(() => '')}`);
  const data = await res.json();
  return data.matches || [];
}

// ── main ─────────────────────────────────────────────────────────────────────
(async function main() {
  if (!API_KEY) {
    die('Set FOOTBALL_DATA_API_KEY in your environment (do not hardcode it).\n' +
        '   e.g.  FOOTBALL_DATA_API_KEY=xxxx node fetch_results.js');
  }
  if (!fs.existsSync(JSON_PATH)) die(`Cannot find ${JSON_PATH}`);

  const DATA = JSON.parse(fs.readFileSync(JSON_PATH, 'utf8'));
  DATA.results = DATA.results || {};

  // canonical team list + slot maps come from entrant 0 (positions are stable)
  const refPicks = DATA.entrants[0].picks;
  const canonicalNames = new Set();
  for (const e of DATA.entrants) for (const p of e.picks) {
    if (p.team1) canonicalNames.add(p.team1);
    if (p.team2) canonicalNames.add(p.team2);
  }
  const resolve = makeResolver(canonicalNames);

  // group fixtures: normalized unordered pair -> { src_row, team1, team2 }
  const groupIndex = new Map();
  for (const p of refPicks) {
    if (typeof p.round === 'string' && p.round.startsWith('Group ')) {
      const key = [normName(p.team1), normName(p.team2)].sort().join(' | ');
      groupIndex.set(key, { src_row: p.src_row, team1: p.team1, team2: p.team2 });
    }
  }
  // knockout slots per round, ascending src_row (positions are stable)
  const koSlots = {};
  for (const rd of KO_ROUNDS) {
    koSlots[rd] = refPicks.filter(p => p.round === rd).map(p => p.src_row).sort((a, b) => a - b);
  }

  const matches = await fetchMatches();
  const finished = matches.filter(m => m.status === 'FINISHED');
  console.log(`Fetched ${matches.length} matches; ${finished.length} finished.`);

  const writes = {};        // src_row -> result object
  const koByRound = {};     // round -> [ {match, home, away, winner, ...} ]
  const reachedByRound = {}; // round -> Set of team names
  const warnings = [];

  for (const m of finished) {
    const round = STAGE_TO_ROUND[m.stage];
    const home = resolve(m.homeTeam && m.homeTeam.name);
    const away = resolve(m.awayTeam && m.awayTeam.name);
    if (!round) { warnings.push(`Unknown stage "${m.stage}" — skipped.`); continue; }
    if (!home || !away) {
      warnings.push(`Unresolved team(s): "${m.homeTeam && m.homeTeam.name}" / ` +
                    `"${m.awayTeam && m.awayTeam.name}" (${m.stage}). Add to TEAM_ALIASES.`);
      continue;
    }

    const ft = (m.score && m.score.fullTime) || {};
    const homeGoals = ft.home, awayGoals = ft.away;
    if (homeGoals == null || awayGoals == null) { warnings.push(`No score for ${home}-${away}.`); continue; }

    const pens = (m.score && m.score.penalties) || {};
    const hasPens = pens.home != null && pens.away != null;
    let winnerName = apiWinnerToName(m.score, home, away);
    if (round !== 'GROUP' && winnerName === 'Draw' && hasPens) {
      winnerName = pens.home > pens.away ? home : away;
    }

    if (round === 'GROUP') {
      const key = [normName(home), normName(away)].sort().join(' | ');
      const slot = groupIndex.get(key);
      if (!slot) { warnings.push(`No group slot for ${home} vs ${away}.`); continue; }
      // align scores to the slot's team1/team2 orientation
      const t1IsHome = normName(slot.team1) === normName(home);
      const score1 = t1IsHome ? homeGoals : awayGoals;
      const score2 = t1IsHome ? awayGoals : homeGoals;
      const winner = score1 > score2 ? slot.team1 : score2 > score1 ? slot.team2 : 'Draw';
      writes[slot.src_row] = {
        team1: slot.team1, team2: slot.team2, score1, score2, winner, final: true,
      };
    } else {
      // collect knockout matches; assign to slots after sorting chronologically
      (koByRound[round] ||= []).push({
        utcDate: m.utcDate, home, away, homeGoals, awayGoals,
        pen1: hasPens ? pens.home : null, pen2: hasPens ? pens.away : null,
        winner: winnerName,
      });
      // a team that played in this round has reached it
      (reachedByRound[round] ||= new Set()).add(home).add(away);
    }
  }

  // assign knockout matches to that round's slots (best-effort, by date order)
  for (const round of KO_ROUNDS) {
    const games = (koByRound[round] || []).slice().sort((a, b) => String(a.utcDate).localeCompare(String(b.utcDate)));
    const slots = koSlots[round] || [];
    if (games.length > slots.length) {
      warnings.push(`${round}: ${games.length} finished matches but only ${slots.length} slots — extra ignored.`);
    }
    const reached = [...(reachedByRound[round] || [])];
    games.forEach((g, i) => {
      if (i >= slots.length) return;
      writes[slots[i]] = {
        team1: g.home, team2: g.away, score1: g.homeGoals, score2: g.awayGoals,
        ...(g.pen1 != null ? { pen1: g.pen1 } : {}),
        ...(g.pen2 != null ? { pen2: g.pen2 } : {}),
        winner: g.winner, reached, final: true,
      };
    });
  }

  // Third place (no `reached` needed — scoring uses winner only)
  for (const m of finished) {
    if (STAGE_TO_ROUND[m.stage] !== 'Third place') continue;
    const home = resolve(m.homeTeam && m.homeTeam.name);
    const away = resolve(m.awayTeam && m.awayTeam.name);
    const ft = (m.score && m.score.fullTime) || {};
    if (!home || !away || ft.home == null) continue;
    const pens = (m.score && m.score.penalties) || {};
    let winner = apiWinnerToName(m.score, home, away);
    if (winner === 'Draw' && pens.home != null) winner = pens.home > pens.away ? home : away;
    const slot = refPicks.find(p => p.round === 'Third place');
    if (slot) {
      writes[slot.src_row] = { team1: home, team2: away, score1: ft.home, score2: ft.away, winner, final: true };
    }
  }

  // ── apply (only finished matches; never touches entrants) ──
  const changed = [];
  for (const [src_row, result] of Object.entries(writes)) {
    const prev = JSON.stringify(DATA.results[src_row]);
    if (prev !== JSON.stringify(result)) changed.push(src_row);
    DATA.results[src_row] = result;
  }

  console.log(`\n${changed.length} slot(s) added/updated: ${changed.sort((a, b) => a - b).join(', ') || '(none)'}`);
  if (warnings.length) {
    console.log('\n⚠ warnings:');
    for (const w of [...new Set(warnings)]) console.log('  - ' + w);
  }

  if (DRY_RUN) {
    console.log('\n--dry-run: no file written.');
    return;
  }
  fs.writeFileSync(JSON_PATH, JSON.stringify(DATA, null, 1));
  console.log(`\n✓ Wrote ${JSON_PATH}. Re-deploy the folder to Netlify to publish.`);
})().catch(err => die(err.stack || err.message));
