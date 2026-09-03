// src/lib/footballData.js
//
// Client for football-data.org (https://www.football-data.org), used to fill
// in the team form / league record fields that The Odds API doesn't provide.
//
// All requests go through /api/football-data/... which is proxied to
// https://api.football-data.org/v4 - by the Vite dev server locally
// (vite.config.js) and by a Netlify Function in production
// (netlify/functions/football-data.js). This keeps the auth token
// server-side, per football-data.org's own recommendation, and avoids
// relying on their CORS support for direct browser calls.

const COMPETITION_CODES = {
  EPL: "PL",
  "La Liga": "PD",
  "Serie A": "SA",
  Bundesliga: "BL1",
};

/** Strip common club-name suffixes so "Arsenal" matches "Arsenal FC". */
function normalizeTeamName(name) {
  const stripWords = new Set(["fc", "cf", "afc", "ac", "sc", "cd", "ud", "rc", "sd", "ca", "club"]);
  return name
    .toLowerCase()
    .replace(/\./g, "")
    .split(" ")
    .filter((w) => w && !stripWords.has(w))
    .join(" ")
    .trim();
}

function namesMatch(a, b) {
  const na = normalizeTeamName(a);
  const nb = normalizeTeamName(b);
  if (!na || !nb) return false;
  return na === nb || na.includes(nb) || nb.includes(na);
}

async function fetchStandings(code) {
  const res = await fetch(`/api/football-data/competitions/${code}/standings`);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`football-data.org error ${res.status} for ${code}: ${body}`);
  }
  return res.json();
}

/** Flatten the TOTAL standings table into a simple array of team rows. */
function indexStandings(standingsResponse) {
  const table = standingsResponse.standings?.find((s) => s.type === "TOTAL")?.table || [];
  return table.map((row) => ({
    name: row.team.name,
    shortName: row.team.shortName,
    position: row.position,
    points: row.points,
    won: row.won,
    draw: row.draw,
    lost: row.lost,
    form: row.form, // e.g. "W,D,L,W,W" - can be null early in a season
  }));
}

function findTeamRow(rows, teamName) {
  return rows.find(
    (r) => namesMatch(r.name, teamName) || (r.shortName && namesMatch(r.shortName, teamName))
  );
}

function formatForm(formStr) {
  if (!formStr) return "— — — — —";
  return formStr.split(",").slice(-5).join(" ");
}

async function fetchCompetitionMatches(code) {
  const res = await fetch(`/api/football-data/competitions/${code}/matches?status=SCHEDULED`);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`football-data.org error ${res.status} for ${code} matches: ${body}`);
  }
  return res.json();
}

function buildLeagueMatchIndex(matchesResponse) {
  const index = [];
  for (const match of matchesResponse.matches || []) {
    index.push({
      id: match.id,
      home: match.homeTeam?.name || "",
      away: match.awayTeam?.name || "",
    });
  }
  return index;
}

/**
 * Fetch each league's scheduled fixtures once and build a map from our
 * match id (from The Odds API) to football-data.org's match id, matched by
 * team name. Needed because head2head is fetched per football-data match id,
 * and The Odds API and football-data.org use different id schemes entirely.
 */
export async function buildMatchIdIndex(matches) {
  const leagues = [...new Set(matches.map((m) => m.league))];
  const indexByLeague = {};

  await Promise.all(
    leagues.map(async (league) => {
      const code = COMPETITION_CODES[league];
      if (!code) return;
      try {
        const data = await fetchCompetitionMatches(code);
        indexByLeague[league] = buildLeagueMatchIndex(data);
      } catch (err) {
        console.warn(`[footballData] couldn't load fixtures for ${league}:`, err.message);
        indexByLeague[league] = null;
      }
    })
  );

  const result = new Map();
  for (const m of matches) {
    const rows = indexByLeague[m.league];
    if (!rows) continue;
    const found = rows.find((r) => namesMatch(r.home, m.home) && namesMatch(r.away, m.away));
    if (found) result.set(m.id, found.id);
  }
  return result;
}

function summarizeHeadToHead(data) {
  const h2h = data.head2head;
  const homeName = data.match?.homeTeam?.name || "Home team";
  const awayName = data.match?.awayTeam?.name || "Away team";
  if (!h2h || !h2h.numberOfMatches) return "No previous meetings on record.";

  const { numberOfMatches, homeTeam, awayTeam } = h2h;
  if (homeTeam.wins > awayTeam.wins && homeTeam.wins > homeTeam.draws) {
    return `${homeName} won ${homeTeam.wins} of the last ${numberOfMatches} meetings`;
  }
  if (awayTeam.wins > homeTeam.wins && awayTeam.wins > homeTeam.draws) {
    return `${awayName} won ${awayTeam.wins} of the last ${numberOfMatches} meetings`;
  }
  return `Evenly matched over the last ${numberOfMatches} meetings (${homeTeam.wins}W-${homeTeam.draws}D-${awayTeam.wins}W)`;
}

/** Fetch head-to-head summary for one match, by football-data.org match id. */
export async function fetchHeadToHead(footballDataMatchId, limit = 10) {
  const res = await fetch(`/api/football-data/matches/${footballDataMatchId}/head2head?limit=${limit}`);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`football-data.org error ${res.status} for head2head: ${body}`);
  }
  const data = await res.json();
  return summarizeHeadToHead(data);
}

/**
 * Fetch standings once per league present in `matches` (not once per match -
 * football-data.org's free tier is capped at 10 requests/minute) and attach
 * form + league record to each match's home/away sides.
 *
 * Team-name matching between The Odds API ("Arsenal") and football-data.org
 * ("Arsenal FC") is done with a simple normalize + substring match - good
 * enough for the big European leagues here, but not bulletproof for every club.
 */
export async function enrichWithStandings(matches) {
  const leagues = [...new Set(matches.map((m) => m.league))];
  const standingsByLeague = {};

  await Promise.all(
    leagues.map(async (league) => {
      const code = COMPETITION_CODES[league];
      if (!code) return;
      try {
        const data = await fetchStandings(code);
        standingsByLeague[league] = indexStandings(data);
      } catch (err) {
        console.warn(`[footballData] couldn't load standings for ${league}:`, err.message);
        standingsByLeague[league] = null;
      }
    })
  );

  return matches.map((m) => {
    const rows = standingsByLeague[m.league];
    if (!rows) return m;
    const homeRow = findTeamRow(rows, m.home);
    const awayRow = findTeamRow(rows, m.away);
    if (!homeRow && !awayRow) return m;

    return {
      ...m,
      form: {
        home: homeRow ? formatForm(homeRow.form) : m.form.home,
        away: awayRow ? formatForm(awayRow.form) : m.form.away,
      },
      record: {
        home: homeRow
          ? `${homeRow.won}-${homeRow.draw}-${homeRow.lost} · #${homeRow.position} in table`
          : m.record.home,
        away: awayRow
          ? `${awayRow.won}-${awayRow.draw}-${awayRow.lost} · #${awayRow.position} in table`
          : m.record.away,
      },
    };
  });
}
