# Flix — Architecture

A static single-page app on **Cloudflare Pages**. **Pages Functions** proxy TMDB for search and metadata. Playback happens in a third-party embed iframe.

```
browser ──► Pages (public/)          static HTML/CSS/JS
   │
   └──────► /api/*  ─► functions/api/_middleware.js ─► route function ─► lib/tmdb.js ─► TMDB
                         method / origin / rate limit       validation       edge cache + trim
```

## Layout

| Path | Purpose |
|------|---------|
| `public/index.html` | Markup for the three views (results, TV, player) |
| `public/js/app.js` | All client logic: router, views, player, Continue watching |
| `public/css/style.css` | Styles |
| `public/_headers` | Security headers and CSP for static assets |
| `functions/api/_middleware.js` | Runs before every `/api/*` request |
| `functions/api/**` | One file per route (file-based routing) |
| `lib/tmdb.js` | TMDB auth, fetch, error mapping, response shaping, edge cache |
| `test/` | `node:test` suite for `lib/` and `functions/` (`npm test`) |

## API

All routes are `GET`, return trimmed JSON, and are cached at the edge (`caches.default`) and in the browser.

| Route | TMDB endpoint | Cache |
|-------|---------------|-------|
| `/api/trending` | `/trending/all/week` | 1 h |
| `/api/search?q=&page=` | `/search/multi` | 10 min |
| `/api/movie/:id` | `/movie/:id` | 6 h |
| `/api/tv/:id` | `/tv/:id` | 6 h |
| `/api/tv/:id/season/:n` | `/tv/:id/season/:n` | 6 h |

Errors are always JSON: `400` for invalid input, `404` for unknown routes or titles, `405` for anything but GET/HEAD, `403` for cross-site browser requests, `429` when rate-limited, and `502`/`503` when TMDB fails. TMDB's raw error bodies are never passed through.

### Middleware (`functions/api/_middleware.js`)
1. Allows only `GET`/`HEAD`.
2. Rejects cross-site browser requests, based on `Sec-Fetch-Site` and `Origin`.
3. Rate-limits per client IP: 30/min for search, 120/min for everything else. It uses the `RATE_LIMITER` binding if one is bound, and otherwise a best-effort in-isolate counter. A Cloudflare WAF rate-limiting rule on `/api/` is the real backstop.
4. Converts the SPA fallback (HTML) into a JSON 404 and catches thrown errors as a JSON 500.
5. Adds `CSP: default-src 'none'`, `nosniff`, `no-referrer` and CORP, with `no-store` on non-200 responses.

### TMDB auth (`lib/tmdb.js`)
`TMDB_API_KEY` can be a v4 Read Access Token (a JWT, sent as `Authorization: Bearer`) or a legacy v3 key (sent as `?api_key=`). The key never reaches the client or the cache keys.

## Client

### Routing
Hash routes, written with `history.pushState`/`replaceState` and read on `popstate`:

| Hash | View |
|------|------|
| `#/` | Continue watching + Trending |
| `#/search/{query}` | Search results (with Load more) |
| `#/tv/{id}` · `#/tv/{id}/season/{n}` | Series and episode list |
| `#/tv/{id}/watch/{season}/{episode}` | Episode player |
| `#/movie/{id}/watch` | Movie player |

`currentRoute()` builds the hash from the player's own ids (`currentPlayerId/Season/Episode`), so every view can be shared and reloaded. In-app navigation updates the URL without re-running the router. Back and forward go through `handleRoute()`.

### Player
- Each source in `SOURCES` builds a movie or TV embed URL from TMDB ids. The buttons switch between sources.
- Each load inserts a **fresh iframe** (`setPlayerSrc`), because changing an existing iframe's `src` adds a browser-history entry and breaks Back.
- Next episode (button, or the `N` key) moves through the season and then into the next one.

### Continue watching
Stored in `localStorage` under `flix:history`. It keeps up to 20 entries, one per movie or series, and a series remembers its latest episode. It's per browser, and nothing is sent to the server.

## Asset versioning
The zone sends static files with a long browser `max-age`. So `index.html` loads `style.css?v=<hash>` and `app.js?v=<hash>`, where the hash covers the file's contents. After changing CSS or JS, run `npm run version-assets`. CI (`npm run check`) fails if a version is out of date.

## Deploy
Pushing to `main` deploys to production on Cloudflare Pages. Other branches get preview deployments. CI (`.github/workflows/ci.yml`) syntax-checks the client and runs `npm test` on every push and PR.

Required environment variable: `TMDB_API_KEY`. Optional binding: `RATE_LIMITER`.

## Not done yet
- Self-hosted fonts.
- Splitting `app.js` into ES modules.
- Per-source iframe sandbox and referrer tuning, which needs testing against each embed.
