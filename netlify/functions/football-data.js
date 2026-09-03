// netlify/functions/football-data.js
//
// Proxies requests to api.football-data.org so the auth token stays
// server-side and the browser never hits football-data.org directly
// (avoids CORS and keeps the token out of client-side JS).
//
// Reads FOOTBALL_DATA_API_KEY from Netlify's environment variables
// (Site settings -> Environment variables) - NOT prefixed with VITE_,
// so it's never bundled into the client build.
//
// Requests to /api/football-data/* are rewritten here by netlify.toml,
// with the trailing path forwarded on to football-data.org's v4 API.

export const handler = async (event) => {
  const apiKey = process.env.FOOTBALL_DATA_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        error: "FOOTBALL_DATA_API_KEY is not set in Netlify environment variables.",
      }),
    };
  }

  // event.path is the original request path, e.g.
  // /api/football-data/competitions/PL/standings
  const suffix = event.path
    .replace(/^\/api\/football-data/, "")
    .replace(/^\/\.netlify\/functions\/football-data/, "");
  const query = event.rawQuery ? `?${event.rawQuery}` : "";
  const target = `https://api.football-data.org/v4${suffix}${query}`;

  try {
    const upstream = await fetch(target, {
      headers: { "X-Auth-Token": apiKey },
    });
    const body = await upstream.text();
    return {
      statusCode: upstream.status,
      headers: { "Content-Type": "application/json" },
      body,
    };
  } catch (err) {
    return {
      statusCode: 502,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: String(err) }),
    };
  }
};
