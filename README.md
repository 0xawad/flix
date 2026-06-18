# Flix 🍿

**Search movies & TV series. Watch instantly.**

A glassy, minimal streaming webapp powered by TMDB metadata and VidCore embedding — served on Cloudflare Pages.

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
   - `TMDB_API_KEY` = your TMDB API read access token
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

## 🛠 Configuration

| Variable | Required | Description |
|----------|----------|-------------|
| `TMDB_API_KEY` | ✅ | Your TMDB API Read Access Token |

## 📦 Stack

- **Hosting:** Cloudflare Pages (free tier)
- **API Proxy:** Cloudflare Pages Functions
- **Metadata:** [TMDB API](https://developers.themoviedb.org/3)
- **Streaming:** [VidCore](https://vidcore.net/)
- **Fonts:** Righteous + Poppins via Google Fonts
- **Icons:** Lucide (inline SVG)

---

<sub>Made with 🍿 because streaming shouldn't be a treasure hunt.</sub>
