# Flix 🍿

**Search movies & TV series. Watch instantly.**

A glassy, minimal streaming webapp powered by TMDB metadata and embedded players — served on Cloudflare Pages.

```
           .--..--.
         /    \/    \
        |  🎬  🍿   |
         \  .--.  /
          \/    \/
         Flix
     Search. Select. Stream.
```

## ✨ Features

- **Search** — TMDB-powered search across 500k+ titles
- **Smart branching** — Movies play instantly, TV series get season/episode pickers
- **Continue watching**: picks up the last movie or episode you opened (stored locally)
- **Next episode**: one click, or press `N`, including across seasons
- **Shareable links**: every view, down to a single episode, has its own URL
- **Glassmorphism** — Liquid glass UI with animated blobs and frosted cards
- **Fast** — Static SPA on Cloudflare's global edge network
- **Zero ads** — Just your content

## 🚀 One-Click Deploy

1. **Fork or push this repo** to your GitHub account
2. Go to [Cloudflare Dashboard → Pages](https://dash.cloudflare.com/?to=/:account/pages)
3. Click **"Create a project"** → **"Connect to Git"**
4. Select this repo, set:
   - **Build command:** *(leave blank — no build step)*
   - **Build output directory:** `public`
5. Under **Environment variables**, add:
   - `TMDB_API_KEY` = your TMDB **API Read Access Token** (v4, recommended) or legacy v3 API key
6. Click **"Save and Deploy"** ☁️

That's it. Your flix is live at `https://your-project.pages.dev` in ~60 seconds.

## 🧪 Local Development

```bash
git clone https://github.com/YOUR_USER/flix
cd flix

# Serve static files locally
npx wrangler pages dev public

# Or use any static server:
python3 -m http.server 8080 --directory public
```

To test the API proxy locally, wrangler will handle the Pages Functions. Make sure `TMDB_API_KEY` is set in your environment or `.dev.vars` file.

```bash
npm test        # API/middleware tests (node:test, no dependencies)
npm run check   # syntax-check, asset-version check, and tests (what CI runs)
npm run version-assets  # run after editing public/css or public/js
```

See [`flix.md`](flix.md) for the architecture.

## 🛠 Configuration

| Variable | Required | Description |
|----------|----------|-------------|
| `TMDB_API_KEY` | ✅ | TMDB API Read Access Token (v4 JWT, sent as a Bearer header). A legacy v3 API key also works. |

Both are on [TMDB → Settings → API](https://www.themoviedb.org/settings/api).

## 🛡 API hardening

All `/api/*` requests pass through `functions/api/_middleware.js`, which:

- allows only `GET`/`HEAD`, and rejects cross-site browser requests
- rate-limits each client IP (30 req/min for search, 120 req/min for everything else)
- adds security and `Cache-Control` headers, and returns JSON 404s for unknown routes

The built-in limiter is per isolate, so it only does its best. For real protection, add a
**Cloudflare WAF rate-limiting rule** on the zone (for example `URI Path starts with /api/`,
100 requests / 1 minute / IP → Block). The free plan includes one rule. If you bind a
Workers Rate Limiting namespace as `RATE_LIMITER`, the middleware uses it instead.

## 📦 Stack

- **Hosting:** Cloudflare Pages (free tier)
- **API Proxy:** Cloudflare Pages Functions
- **Metadata:** [TMDB API](https://developers.themoviedb.org/3)
- **Playback:** third-party embeds (see `SOURCES` in `public/js/app.js`)
- **Fonts:** Righteous + Poppins via Google Fonts
- **Icons:** Lucide (inline SVG)

---

<sub>Made with 🍿 because streaming shouldn't be a treasure hunt.</sub>
