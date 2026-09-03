// src/lib/oddsApi.js
// Thin client for The Odds API (https://the-odds-api.com)
// Free tier: 500 requests/month, all sports including soccer.
// Get a key at https://the-odds-api.com/ (no card required).

// Routed through a Netlify Function proxy (netlify/functions/odds-api.js) so
// the browser never calls api.the-odds-api.com directly - avoids CORS issues
// blocking the fetch() call in production.
const BASE_URL = "/api/market-lines";

// Sport keys we show in the app. Add/remove as you like -
// full list: https://the-odds-api.com/sports-odds-data/sports-apis.html
export const LEAGUE_SPORT_KEYS = {
  EPL: "soccer_epl",
  "La Liga": "soccer_spain_la_liga",
  "Serie A": "soccer_italy_serie_a",
  Bundesliga: "soccer_germany_bundesliga1",
};

/**
 * Fetch upcoming h2h (moneyline / 1X2) odds for one league.
 * Returns raw events from The Odds API, via the server-side proxy
 * (the API key is attached server-side, not here).
 */
async function fetchLeagueOdds(sportKey, { regions = "eu", markets = "h2h" } = {}) {
  const url = `${BASE_URL}/sports/${sportKey}/lines?regions=${regions}&markets=${markets}&oddsFormat=decimal`;
  const res = await fetch(url);

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Odds API error ${res.status} for ${sportKey}: ${body}`);
  }

  // The API returns remaining quota in headers - useful to surface in dev.
  const remaining = res.headers.get("x-requests-remaining");
  if (remaining) console.info(`[oddsApi] requests remaining this month: ${remaining}`);

  return res.json();
}

/** Average the h2h price for an outcome across all bookmakers in an event. */
function averagePrice(event, outcomeName) {
  const prices = [];
  for (const bookmaker of event.bookmakers || []) {
    const market = bookmaker.markets?.find((m) => m.key === "h2h");
    const outcome = market?.outcomes?.find((o) => o.name === outcomeName);
    if (outcome) prices.push(outcome.price);
  }
  if (!prices.length) return null;
  return Math.round((prices.reduce((a, b) => a + b, 0) / prices.length) * 100) / 100;
}

/** Simple market-implied probability model (no real prediction model - see note below). */
function impliedProbabilities(odds) {
  const invHome = 1 / odds.home;
  const invDraw = 1 / odds.draw;
  const invAway = 1 / odds.away;
  const overround = invHome + invDraw + invAway;
  return {
    home: Math.round((invHome / overround) * 1000) / 10,
    draw: Math.round((invDraw / overround) * 1000) / 10,
    away: Math.round((invAway / overround) * 1000) / 10,
  };
}

/**
 * Fetch and normalize matches for the given league names into the shape
 * Formline's UI components already expect (id, league, home, away, odds, pred, confidence...).
 *
 * NOTE: `pred` (the model's win/draw/loss %) and `confidence` were originally mock
 * numbers implying Formline has a proprietary prediction model. This client does NOT
 * have one - it derives `pred` from de-vigged market odds instead, and sets
 * `confidence` as a placeholder based on how many bookmakers are quoting the match.
 * Swap `impliedProbabilities` out for your own model's output whenever you have one.
 */
export async function fetchMatches(leagueNames = Object.keys(LEAGUE_SPORT_KEYS)) {
  const results = await Promise.all(
    leagueNames.map(async (league) => {
      const sportKey = LEAGUE_SPORT_KEYS[league];
      if (!sportKey) return [];
      const events = await fetchLeagueOdds(sportKey);

      return events
        .map((event) => {
          const odds = {
            home: averagePrice(event, event.home_team),
            draw: averagePrice(event, "Draw"),
            away: averagePrice(event, event.away_team),
          };
          if (!odds.home || !odds.draw || !odds.away) return null; // skip incomplete markets
          const pred = impliedProbabilities(odds);
          const bookCount = event.bookmakers?.length || 0;

          return {
          id: event.id,
          league,
          home: event.home_team,
          away: event.away_team,
          commenceTime: event.commence_time,
          kickoff: new Date(event.commence_time).toLocaleString(undefined, {
            weekday: "short",
            hour: "2-digit",
            minute: "2-digit",
          }),
          odds,
          pred: pred || { home: 33, draw: 34, away: 33 },
          confidence: Math.min(95, 30 + bookCount * 8),
          // The fields below aren't in The Odds API's h2h response - left blank
          // until you wire up a stats/injury data source (e.g. API-Football).
          form: { home: "— — — — —", away: "— — — — —" },
          record: { home: "—", away: "—" },
          h2h: "—",
          goals: { homeFor: null, homeAgainst: null, awayFor: null, awayAgainst: null },
          injuries: "—",
            reasons: [`Derived from ${bookCount} bookmaker${bookCount === 1 ? "" : "s"}' odds`],
          };
        })
        .filter(Boolean);
    })
  );

  return results.flat().sort((a, b) => new Date(a.commenceTime) - new Date(b.commenceTime));
}
