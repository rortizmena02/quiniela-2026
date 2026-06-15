#!/usr/bin/env node
/*
 * fetch_results.js — refresh quiniela_brackets_v4.json with real World Cup 2026
 * results from the openfootball public-domain dataset (no API key required).
 *
 * SOURCE
 *   https://raw.githubusercontent.com/openfootball/worldcup.json/master/2026/worldcup.json
 *
 * USAGE
 *   node fetch_results.js
 *   node fetch_results.js --dry-run
 *   node fetch_results.js --file ./quiniela_brackets_v4.json
 *
 * WHAT IT DOES
 *   - Fetches the openfootball worldcup.json (plain JSON, keyless).
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
const SOURCE_URL = process.env.OPENFOOTBALL_URL ||
  'https://raw.githubusercontent.com/openfootball/worldcup.json/master/2026/worldcup.json';

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const fileArgIdx = args.indexOf('--file');
const JSON_PATH = path.resolve(
  fileArgIdx !== -1 && args[fileArgIdx + 1] ? args[fileArgIdx + 1] : './quiniela_brackets_v4.json'
);

const KO_ROUNDS = ['Round of 32', 'Round of 16', 'Quarter-final', 'Semi-final', 'Final'];

// openfootball/source team name -> quiniela canonical name (only the non-obvious
// ones). Matching first tries an exact normalized comparison against the names
// already in your JSON, then falls back to this alias table.
const TEAM_ALIASES = {
  'south korea': 'Rep. of Korea',
  'korea republic': 'Rep. of Korea',
  'republic of korea': 'Rep. of Korea',
  'czech republic': 'Czech Rep.',
  'czechia': 'Czech Rep.',
  'bosnia and herzegovina': 'Bosnia/Herzeg.',
  'bosnia herzegovina': 'Bosnia/Herzeg.',
  'iran': 'IR Iran',
  'ir iran': 'IR Iran',
  'islamic republic of iran': 'IR Iran',
  'turkiye': 'Turkey',
  'united states': 'USA',
  'united states of america': 'USA',
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

function makeResolver(canonicalNames) {
  const byNorm = new Map();
  for (const name of canonicalNames) byNorm.set(normName(name), name);
  return function resolve(apiName) {
    const n = normName(apiName);
    if (byNorm.has(n)) return byNorm.get(n);
    if (TEAM_ALIASES[n]) {
      const alias = TEAM_ALIASES[n];
      return byNorm.get(normName(alias)) || alias;
    }
    return null;
  };
}

// openfootball team fields can be a string or { name, code }
function teamName(t) {
  if (t == null) return null;
  if (typeof t === 'string') return t;
  return t.name || t.title || t.code || null;
}

// map an openfootball knockout round label to a quiniela round
function koRoundLabel(raw) {
  const n = normName(raw);
  if (!n) return null;
  if (/round of 32|last 32|1 32/.test(n)) return 'Round of 32';
  if (/round of 16|last 16|1 16/.test(n)) return 'Round of 16';
  if (/quarter/.test(n)) return 'Quarter-final';
  if (/semi/.test(n)) return 'Semi-final';
  if (/third|3rd|3 4|play off for third|bronze/.test(n)) return 'Third place';
  if (/final/.test(n)) return 'Final';   // checked after semi to avoid "semifinal"
  return null;
}

// flatten the various openfootball container shapes into a flat match list
function collectMatches(data) {
  const out = [];
  const pushAll = arr => { if (Array.isArray(arr)) out.push(...arr); };
  if (Array.isArray(data.matches)) pushAll(data.matches);
  if (Array.isArray(data.rounds)) for (const r of data.rounds) pushAll(r.matches);
  if (Array.isArray(data.stages)) for (const s of data.stages) {
    pushAll(s.matches);
    if (Array.isArray(s.rounds)) for (const r of s.rounds) pushAll(r.matches);
  }
  return out;
}

// extract [home, away] regulation/ET score + optional penalties from a match
function readScore(m) {
  const s = m.score || {};
  // openfootball: { ft:[a,b], ht:[..], et:[..], p:[..] }  (some files use full words)
  const ft = s.ft || s.fullTime || s.full_time || (Array.isArray(s) ? s : null);
  const et = s.et || s.extraTime || s.extra_time || null;
  const p = s.p || s.pen || s.penalties || null;
  const reg = (Array.isArray(et) && et.length === 2) ? et
            : (Array.isArray(ft) && ft.length === 2) ? ft
            : null;
  const pens = (Array.isArray(p) && p.length === 2) ? p : null;
  return { reg, pens };
}

async function fetchSource() {
  if (typeof fetch !== 'function') {
    die('global fetch() not available — please use Node 18+ (node --version).');
  }
  const res = await fetch(SOURCE_URL, { headers: { 'accept': 'application/json' } });
  if (!res.ok) {
    die(`Could not fetch openfootball data (HTTP ${res.status}) from\n   ${SOURCE_URL}\n` +
        `If the 2026 file isn't published yet, the season may not have started. ` +
        `You can point at another path with OPENFOOTBALL_URL=...`);
  }
  return res.json();
}

// ── main ─────────────────────────────────────────────────────────────────────
(async function main() {
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
  const thirdSlot = refPicks.find(p => p.round === 'Third place');

  const data = await fetchSource();
  const allMatches = collectMatches(data);
  console.log(`Fetched ${allMatches.length} matches from openfootball.`);

  const writes = {};            // src_row -> result object
  const koByRound = {};         // round -> [ game ]
  const reachedByRound = {};    // round -> Set
  const warnings = [];
  let finishedCount = 0;

  for (const m of allMatches) {
    const { reg, pens } = readScore(m);
    if (!reg || reg[0] == null || reg[1] == null) continue; // not finished
    finishedCount++;

    const home = resolve(teamName(m.team1 || m.home || m.team_1));
    const away = resolve(teamName(m.team2 || m.away || m.team_2));
    if (!home || !away) {
      warnings.push(`Unresolved team(s): "${teamName(m.team1)}" / "${teamName(m.team2)}". Add to TEAM_ALIASES.`);
      continue;
    }

    const isGroup = m.group != null || /^group/i.test(String(m.round || ''));
    const koRound = isGroup ? null : koRoundLabel(m.round || m.stage || m.name);

    // winner from regulation/ET, with penalties as tiebreak
    let winnerName;
    if (pens && pens[0] !== pens[1]) winnerName = pens[0] > pens[1] ? home : away;
    else winnerName = reg[0] > reg[1] ? home : reg[1] > reg[0] ? away : 'Draw';

    if (isGroup) {
      const key = [normName(home), normName(away)].sort().join(' | ');
      const slot = groupIndex.get(key);
      if (!slot) { warnings.push(`No group slot for ${home} vs ${away}.`); continue; }
      const t1IsHome = normName(slot.team1) === normName(home);
      const score1 = t1IsHome ? reg[0] : reg[1];
      const score2 = t1IsHome ? reg[1] : reg[0];
      const winner = score1 > score2 ? slot.team1 : score2 > score1 ? slot.team2 : 'Draw';
      writes[slot.src_row] = { team1: slot.team1, team2: slot.team2, score1, score2, winner, final: true };

    } else if (koRound === 'Third place') {
      if (thirdSlot) {
        writes[thirdSlot.src_row] = {
          team1: home, team2: away, score1: reg[0], score2: reg[1], winner: winnerName, final: true,
        };
      }

    } else if (koRound) {
      (koByRound[koRound] ||= []).push({
        date: m.date || m.utcDate || '', home, away,
        score1: reg[0], score2: reg[1],
        pen1: pens ? pens[0] : null, pen2: pens ? pens[1] : null,
        winner: winnerName,
      });
      (reachedByRound[koRound] ||= new Set()).add(home).add(away);

    } else {
      warnings.push(`Unrecognised round "${m.round || m.stage || m.name}" — skipped.`);
    }
  }

  // assign knockout matches to that round's slots (best-effort, by date order)
  for (const round of KO_ROUNDS) {
    const games = (koByRound[round] || []).slice().sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const slots = koSlots[round] || [];
    if (games.length > slots.length) {
      warnings.push(`${round}: ${games.length} finished matches but only ${slots.length} slots — extra ignored.`);
    }
    const reached = [...(reachedByRound[round] || [])];
    games.forEach((g, i) => {
      if (i >= slots.length) return;
      writes[slots[i]] = {
        team1: g.home, team2: g.away, score1: g.score1, score2: g.score2,
        ...(g.pen1 != null ? { pen1: g.pen1 } : {}),
        ...(g.pen2 != null ? { pen2: g.pen2 } : {}),
        winner: g.winner, reached, final: true,
      };
    });
  }

  console.log(`${finishedCount} finished match(es) parsed.`);

  // ── apply (only finished matches; never touches entrants) ──
  const changed = [];
  for (const [src_row, result] of Object.entries(writes)) {
    if (JSON.stringify(DATA.results[src_row]) !== JSON.stringify(result)) changed.push(src_row);
    DATA.results[src_row] = result;
  }

  console.log(`\n${changed.length} slot(s) added/updated: ${changed.sort((a, b) => a - b).join(', ') || '(none)'}`);
  if (warnings.length) {
    console.log('\n⚠ warnings:');
    for (const w of [...new Set(warnings)]) console.log('  - ' + w);
  }

  if (DRY_RUN) {
    console.log('\n--dry-run: no file written. Sample of what would be written:');
    const sample = Object.fromEntries(Object.entries(writes).slice(0, 6));
    console.log(JSON.stringify(sample, null, 2));
    return;
  }
  fs.writeFileSync(JSON_PATH, JSON.stringify(DATA, null, 1));
  console.log(`\n✓ Wrote ${JSON_PATH}.`);
})().catch(err => die(err.stack || err.message));
