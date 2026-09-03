# Formline

A football match dashboard: live odds, a value-bet finder, and a bet tracker,
built with React + Vite. Live match odds come from
[The Odds API](https://the-odds-api.com); bets are stored in
[Supabase](https://supabase.com) so they persist across reloads and devices.

## 1. Install dependencies

```bash
npm install
```

## 2. Get a free Odds API key

1. Go to https://the-odds-api.com/ and sign up (no card required).
2. Copy the API key from your account page.
3. Free tier gives you 500 credits/month. Each odds request across our 4
   leagues (EPL, La Liga, Serie A, Bundesliga) costs roughly 4 credits, so a
   refresh is cheap - but avoid polling on every render (the app only fetches
   on load and when you click Retry).

## 3. Get a free football-data.org key (team form / league standings)

1. Go to https://www.football-data.org/ and register for a free key.
2. Free tier: 10 requests/minute, covers PL, La Liga, Serie A, Bundesliga
   (among others) with standings.
3. **Keep this key server-side** — do not prefix it with `VITE_`. It's read
   by `vite.config.js` locally (via a dev-server proxy) and by a Netlify
   Function in production, so it's never bundled into the browser build.

## 4. Set up Supabase

1. Create a free project at https://supabase.com.
2. In the Supabase dashboard, go to **SQL Editor -> New query**, paste the
   contents of `supabase/schema.sql`, and run it. This creates the `bets`
   table with row-level security and realtime enabled.
3. Go to **Project Settings -> API** and copy the **Project URL** and
   **anon public key**.

## 5. Configure environment variables

```bash
cp .env.example .env
```

Then fill in `.env`:

```
VITE_ODDS_API_KEY=your_odds_api_key
FOOTBALL_DATA_API_KEY=your_football_data_key
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your_anon_key
```

`.env` is gitignored - never commit it. Note `FOOTBALL_DATA_API_KEY` has no
`VITE_` prefix on purpose — see step 3.

## 6. Run it

```bash
npm run dev
```

Open the URL Vite prints (usually http://localhost:5173).

## What's live vs. still mock

- **Dashboard, Matches, Value bets** — pull real upcoming fixtures and h2h
  (1X2) odds from The Odds API for EPL, La Liga, Serie A, and Bundesliga.
- **Team form and league record** — pulled from football-data.org standings
  (one request per league, cached per session) and matched to teams by name.
  Matching is a simple normalize + substring check, so a handful of clubs
  with unusual naming might not match perfectly.
- **Bet tracker** — bets are saved to Supabase (`bets` table) and sync in
  real time across tabs/devices via Supabase Realtime.
- **`pred` (model %) and `confidence`** — the original mock data implied a
  proprietary prediction model. This build doesn't have one: `pred` is
  derived from de-vigged market odds (`src/lib/oddsApi.js ->
  impliedProbabilities`), and `confidence` is a placeholder based on how many
  bookmakers are quoting a match. Swap this out for your own model's output
  whenever you have one.
- **Head-to-head** — fetched lazily from football-data.org when you open a
  match's detail panel (not upfront for every match, to stay well within the
  free tier's 10 requests/minute), and cached per session once loaded.
- **Goals per game, injuries** — not covered by either API wired up here.
  Those fields still show "—" until you add a source for them (e.g.
  API-Football for injuries, or football-data.org's team match history for
  goals for/against).
- **Stats page charts and Alerts page** — still using illustrative mock data
  (`LEAGUE_STATS`, `MONTHLY_PL`, `CONFIDENCE_ACCURACY`, `ALERTS` in
  `src/App.jsx`). Wire these to real bet history / notifications when ready.

## Project structure

```
src/
  App.jsx           Main app (all pages/components)
  lib/
    oddsApi.js       The Odds API client + normalization
    footballData.js  football-data.org client (team form/standings)
    supabase.js      Supabase client + bets CRUD
netlify/
  functions/
    football-data.js Production proxy for football-data.org (keeps token server-side)
supabase/
  schema.sql        Run this in Supabase's SQL editor to create the bets table
netlify.toml        Routes /api/football-data/* to the Netlify Function above
vite.config.js      Routes /api/football-data/* to football-data.org in local dev
```

## Deploying

```bash
npm run build
```

Output goes to `dist/`. Deploy to Netlify (same as your MIC Radiology App).
In the Netlify dashboard, set these environment variables under **Site
settings -> Environment variables**:

- `VITE_ODDS_API_KEY`
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `FOOTBALL_DATA_API_KEY` (no `VITE_` prefix — this one must stay server-side)

`netlify.toml` is already set up to run `npm run build`, publish `dist/`, and
route `/api/football-data/*` to the serverless function in
`netlify/functions/`, so football-data.org calls keep working in production
exactly like they do in `npm run dev`.
