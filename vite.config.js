import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Third arg '' loads ALL env vars (not just VITE_-prefixed ones), so we can
  // read a server-only secret here without it ever being bundled into client JS.
  const env = loadEnv(mode, process.cwd(), '')

  return {
    plugins: [react()],
    server: {
      proxy: {
        // Proxies football-data.org requests through the Vite dev server so
        // the browser never talks to api.football-data.org directly (avoids
        // CORS issues and keeps the auth token out of client-side code).
        // Mirrors the /.netlify/functions/football-data proxy used in production
        // (see netlify/functions/football-data.js + netlify.toml).
        '/api/football-data': {
          target: 'https://api.football-data.org',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/football-data/, '/v4'),
          headers: {
            'X-Auth-Token': env.FOOTBALL_DATA_API_KEY || '',
          },
        },
        // Proxies The Odds API requests through the Vite dev server too,
        // mirroring the /.netlify/functions/odds-api proxy used in production
        // (see netlify/functions/odds-api.js + netlify.toml).
        '/api/odds': {
          target: 'https://api.the-odds-api.com',
          changeOrigin: true,
          rewrite: (path) => {
            const [pathname, search] = path.replace(/^\/api\/odds/, '/v4').split('?')
            const params = new URLSearchParams(search || '')
            params.set('apiKey', env.ODDS_API_KEY || env.VITE_ODDS_API_KEY || '')
            return `${pathname}?${params.toString()}`
          },
        },
      },
    },
  }
})
