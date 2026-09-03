// netlify/functions/market-lines.js
//
// Proxies requests to api.the-odds-api.com so the browser never has to call
// the-odds-api.com directly. Mirrors the football-data.js proxy - this avoids
// any CORS restriction on the odds API blocking the in-app fetch() call.
//
// Deliberately named/routed to avoid the word "odds" in the client-facing
// URL: some ISPs and mobile carriers apply content filtering to gambling-
// related keywords in URLs, which can silently block requests before they
// even reach Netlify. The path segment "lines" is translated back to
// "odds" here, server-side, before calling the real upstream API.
//
// Reads ODDS_API_KEY from Netlify's environment variables (server-side only).
//
// Requests to /api/market-lines/* are rewritten here by netlify.toml, with
// the trailing path/query forwarded on to The Odds API's v4 endpoint.

export const handler = async (event) => {
  const apiKey = process.env.ODDS_API_KEY || process.env.VITE_ODDS_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        error: "ODDS_API_KEY is not set in Netlify environment variables.",
      }),
    };
  }

  // event.path looks like /.netlify/functions/market-lines/sports/soccer_epl/lines
  const suffix = event.path
    .replace(/^\/\.netlify\/functions\/market-lines/, "")
    .replace(/\/lines$/, "/odds");
  const params = new URLSearchParams(event.rawQuery || "");
  params.set("apiKey", apiKey);
  const target = `https://api.the-odds-api.com/v4${suffix}?${params.toString()}`;

  if (params.get("debug") === "1") {
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        eventPath: event.path,
        rawQuery: event.rawQuery,
        computedSuffix: suffix,
        target: target.replace(apiKey, "REDACTED"),
      }),
    };
  }

  try {
    const upstream = await fetch(target);
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
