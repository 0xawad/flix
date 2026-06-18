# Architecture Plan: Searchable Streaming Web App (Cloudflare Pages Deployment)

## 1. Project Overview
This document outlines the high-level architecture for a minimal web application that allows users to search for movies and TV series by title and stream them via the VidCore embedding service. The application eliminates manual ID entry by integrating the TMDB API for discovery, metadata retrieval, and episode-level navigation. The entire project is designed to be deployed on **Cloudflare Pages** using its free plan, leveraging both static hosting and serverless functions.

---

## 2. Core System Components

### 2.1 Frontend Application (Static Assets)
- **Hosting**: Cloudflare Pages serves all static files (HTML, CSS, JavaScript, images).
- **Responsibility**: Renders the search interface, result grids, season/episode pickers, and the video player iframe.
- **Client‑Side Logic**: Handles user interactions, manages application state, and communicates with the backend proxy for TMDB data.

### 2.2 Backend API Proxy (Pages Functions)
- **Implementation**: Cloudflare Pages Functions (serverless Workers) act as a secure intermediary.
- **Responsibility**: 
  - Stores the TMDB API key securely (environment variable).
  - Forwards search and metadata requests to TMDB.
  - Optionally caches responses to reduce rate‑limit hits.
- **Benefit**: No separate server to manage; functions are deployed alongside the static site.

### 2.3 External Dependencies

#### A. Metadata & Search Provider – TMDB
- Provides unified search across movies, TV series, and people.
- Supplies detailed metadata: poster images, release/air dates, season lists, episode names, and unique TMDB IDs for every movie, series, and individual episode.
- Official API documentation: [TMDB API Docs](https://developers.themoviedb.org/3)

#### B. Streaming Provider – VidCore
- Offers a lightweight embedding endpoint that accepts a TMDB or IMDB ID.
- Renders a fully functional video player with subtitle and playback controls.
- Supports optional customisation parameters (autoplay, theme, subtitles, etc.).
- Reference: [VidCore](https://vidcore.net/) (embedding guide available on the site)

---

## 3. User Workflow & Logic Branching

### 3.1 Search Phase
1. User enters a title into the search field.
2. The frontend sends a request to the Cloudflare Pages Function (e.g., `/api/search?q=...`).
3. The function forwards the request to TMDB’s `/search/multi` endpoint (with the API key).
4. The frontend filters results to **Movies** and **TV Shows** (excluding persons).
5. Results are displayed as a visual grid with poster, title, year, and media‑type badge.

### 3.2 Selection Phase (Branching Logic)

#### Case A: Movie Selected
- The frontend captures the TMDB movie ID.
- Instantly constructs the VidCore URL: `https://vidcore.net/movie/{id}` and embeds the player.

#### Case B: TV Series Selected
- The frontend requests series details via the proxy: `/api/tv/{series_id}`.
- The function retrieves the full season list from TMDB.
- A season‑selection dropdown is populated (excluding specials/season 0).
- Upon season selection, the frontend requests episodes: `/api/tv/{series_id}/season/{season_number}`.
- The function returns episode data including numbers, names, air dates, and episode IDs.
- The user clicks an episode to start playback.

### 3.3 Playback Phase
- The frontend uses the selected media ID (movie ID or episode ID) and builds the VidCore iframe URL.
- The player is rendered with optional query parameters (e.g., `autoPlay=true`).
- The user can watch the content with standard player controls.

---

## 4. Data Flow & API Endpoints (via Pages Functions)

| Purpose                      | Frontend Route (to Proxy)       | TMDB Endpoint (called by Proxy)          | Key Data Returned                          |
| :--------------------------- | :------------------------------ | :---------------------------------------- | :----------------------------------------- |
| Unified Search               | `/api/search?query={q}`         | `/search/multi`                           | Results with `media_type`, `id`, title, poster, date |
| Series Details               | `/api/tv/{series_id}`           | `/tv/{series_id}`                         | Full season list with `season_number`      |
| Season Episodes              | `/api/tv/{series_id}/season/{num}` | `/tv/{series_id}/season/{season_number}` | Episode list with `id`, `episode_number`, `name`, `air_date` |
| Image Assets                 | Direct URL from TMDB            | `https://image.tmdb.org/t/p/{size}/{path}` | Poster / backdrop images                    |

**Note:** The proxy functions handle authentication, rate limiting, and optional caching. The frontend never sees the TMDB API key.

---

## 5. VidCore Embedding Pattern

- **Base URL**: `https://vidcore.net/movie/`
- **ID Parameter**: Accepts both TMDB movie IDs and TMDB episode IDs without distinction.
- **Optional Query Parameters** (can be appended):
  - `autoPlay` – `true`/`false`
  - `startAt` – seconds to start
  - `theme` – hex colour (without `#`)
  - `sub` – language code (e.g., `en`, `es`)
  - `title` – show/hide title
  - `poster` – show/hide poster
  - `fullscreenButton`, `chromecast`, `hideServer`, etc.

---

## 6. Deployment Architecture – Cloudflare Pages

### 6.1 Project Structure
- **Repository**: Git‑based (GitHub/GitLab) – triggers automatic builds and deployments.
- **Static Assets**: All frontend files served directly from the Pages CDN.
- **Functions Directory**: `/functions` – contains serverless code for API proxying.

### 6.2 Deployment Workflow
1. Push code to the connected repository.
2. Cloudflare Pages builds the project (static files and functions).
3. Deployment is published to a `*.pages.dev` subdomain or a custom domain.
4. Each deployment is versioned, and rollbacks are one‑click.

### 6.3 Free Plan Considerations
- **Builds**: 500 builds/month – sufficient for active development.
- **Build Timeout**: 20 minutes – well beyond typical build times.
- **File Count**: 20,000 files – ample for a single‑page application.
- **Functions Requests**: 100,000 requests/day – more than enough for a personal project or early‑stage app.
- **Bandwidth**: Unlimited – a key advantage for video‑embedding apps.
- **Custom Domains**: Up to 100 per project.

### 6.4 Security
- TMDB API key is stored as an **environment variable** in Cloudflare Pages (dashboard or via `wrangler.toml`).
- Pages Functions run in a secure isolation environment; the key is never exposed to the client.

---

## 7. External Sources & Reference Documentation

- **Cloudflare Pages Documentation**
  - [Pages Overview](https://developers.cloudflare.com/pages/)
  - [Pages Functions (Workers)](https://developers.cloudflare.com/pages/platform/functions/)
  - [Environment Variables](https://developers.cloudflare.com/pages/platform/environment-variables/)
- **TMDB API Documentation**
  - [Search API](https://developers.themoviedb.org/3/search)
  - [TV Details](https://developers.themoviedb.org/3/tv)
  - [Seasons & Episodes](https://developers.themoviedb.org/3/tv-seasons)
  - [Image Configuration](https://developers.themoviedb.org/3/configuration)
- **VidCore**
  - Embedding guide (available on [vidcore.net](https://vidcore.net/))
  - Community support via Discord (link on website)

---

## 8. Operational & Performance Guidelines

- **Caching**: Implement caching at the proxy level for frequently searched titles and popular series metadata to reduce TMDB API calls.
- **Error Handling**: Graceful fallbacks when TMDB returns no results, a series has no episodes, or VidCore fails to load an ID.
- **Loading States**: Provide visual feedback (spinners, skeletons) during search and metadata fetching.
- **Mobile Responsiveness**: Ensure the grid, picker, and iframe adapt to different screen sizes.
- **Rate Limiting**: The proxy should respect TMDB’s rate limits; consider queuing or retry logic.

---

*This plan serves as a blueprint for development and deployment. It focuses on architectural decisions and data flow, without prescribing specific frontend frameworks or UI designs.*
