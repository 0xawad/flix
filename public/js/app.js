'use strict';

// Flix client. Every screen is derived from the URL hash by `onRoute()`;
// links are real anchors, so back/forward, sharing and reloads all work.

const IMG = 'https://image.tmdb.org/t/p';

const SOURCES = [
  {
    name: 'Peachify',
    movie: (id) => `https://peachify.top/embed/movie/${id}`,
    tv: (id, s, e) => `https://peachify.top/embed/tv/${id}/${s}/${e}`,
  },
  {
    name: 'VidFast',
    movie: (id) => `https://vidfast.vc/movie/${id}`,
    tv: (id, s, e) => `https://vidfast.vc/tv/${id}/${s}/${e}`,
  },
  {
    name: 'VidNest',
    movie: (id) => `https://vidnest.fun/movie/${id}`,
    tv: (id, s, e) => `https://vidnest.fun/tv/${id}/${s}/${e}`,
  },
];

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const dom = {
  topbar: $('#topbar'),
  searchForm: $('#search-form'),
  searchInput: $('#search-input'),
  searchClear: $('#search-clear'),
  verifyOverlay: $('#verify-overlay'),
  verifyWidget: $('#verify-widget'),
  views: {
    home: $('#view-home'),
    search: $('#view-search'),
    title: $('#view-title'),
    player: $('#view-player'),
  },
};

// ─── UTIL ───

function escape(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function toInt(val) {
  const n = Number(val);
  return Number.isInteger(n) && n > 0 ? n : null;
}

const icon = (name) => `<svg class="icon" aria-hidden="true"><use href="#i-${name}"/></svg>`;
const titleOf = (item) => item?.title || item?.name || 'Untitled';
const yearOf = (item) => (item?.release_date || item?.first_air_date || '').slice(0, 4);
const typeLabel = (type) => (type === 'tv' ? 'Series' : 'Movie');

function fmtRuntime(min) {
  if (!min) return '';
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h ? `${h}h${m ? ` ${m}m` : ''}` : `${m}m`;
}

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

const isFuture = (iso) => Boolean(iso) && new Date(`${iso}T00:00:00`) > new Date();

function ratingHTML(vote) {
  return vote ? `<span class="meta-rating">${icon('star')}${vote.toFixed(1)}</span>` : '';
}

const IMG_SIZES = {
  poster: [['w185', 185], ['w342', 342], ['w500', 500]],
  backdrop: [['w780', 780], ['w1280', 1280]],
  still: [['w185', 185], ['w300', 300]],
};

// <img> with a TMDB srcset, faded in once loaded (see fadeIn).
function imgHTML(path, alt, { kind = 'poster', sizes = '200px', eager = false, cls = '' } = {}) {
  if (!path) return `<div class="no-image">${icon('film')}</div>`;
  const set = IMG_SIZES[kind];
  const srcset = set.map(([size, w]) => `${IMG}/${size}${path} ${w}w`).join(', ');
  const src = `${IMG}/${set[Math.min(1, set.length - 1)][0]}${path}`;
  return `<img class="fade ${cls}" src="${src}" srcset="${srcset}" sizes="${sizes}" alt="${escape(alt)}" `
    + `${eager ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async">`;
}

function fadeIn(root) {
  for (const img of $$('img.fade:not(.is-loaded)', root)) {
    const done = () => img.classList.add('is-loaded');
    if (img.complete) done();
    else {
      img.addEventListener('load', done, { once: true });
      img.addEventListener('error', done, { once: true });
    }
  }
}

// ─── ROUTES ───

const href = {
  home: () => '#/',
  search: (q) => `#/search/${encodeURIComponent(q)}`,
  title: (type, id, season) => (type === 'tv' && season ? `#/tv/${id}/season/${season}` : `#/${type}/${id}`),
  watch: (type, id, season, episode) =>
    (type === 'tv' ? `#/tv/${id}/watch/${season}/${episode}` : `#/movie/${id}/watch`),
};

function parseRoute(hash) {
  const parts = hash.replace(/^#\/?/, '').split('/');
  const [head] = parts;

  if (head === 'search') {
    let q = '';
    try { q = decodeURIComponent(parts.slice(1).join('/')).trim(); } catch { /* malformed */ }
    return q ? { name: 'search', q: q.slice(0, 100) } : { name: 'home' };
  }

  if (head === 'movie' || head === 'tv') {
    const id = toInt(parts[1]);
    if (!id) return { name: 'home', invalid: true };
    if (parts[2] === 'watch') {
      if (head === 'movie') return { name: 'player', type: 'movie', id };
      const season = toInt(parts[3]);
      const episode = toInt(parts[4]);
      if (season && episode) return { name: 'player', type: 'tv', id, season, episode };
      return { name: 'title', type: 'tv', id };
    }
    const season = head === 'tv' && parts[2] === 'season' ? toInt(parts[3]) : null;
    return { name: 'title', type: head, id, season };
  }

  return { name: 'home', invalid: Boolean(head) };
}

const navigate = (to, { replace = false } = {}) => {
  if (replace) location.replace(to);
  else location.hash = to;
};

// In-app history, so "Back" stays inside the app when the page was opened directly.
const visited = [];
const scrollPositions = new Map();
let current = null;

function goBack() {
  if (visited.length > 1) {
    history.back();
  } else {
    const parent = current?.name === 'player' ? href.title(current.type, current.id, current.season) : href.home();
    navigate(parent, { replace: true });
  }
}

function onRoute() {
  const hash = location.hash || '#/';
  if (visited.length > 1 && visited[visited.length - 2] === hash) visited.pop();
  else if (visited[visited.length - 1] !== hash) visited.push(hash);

  if (current) scrollPositions.set(current.hash, window.scrollY);

  const route = { ...parseRoute(hash), hash };
  if (route.invalid) {
    navigate('#/', { replace: true });
    return;
  }

  const prev = current;
  current = route;
  if (prev?.name === 'player' && route.name !== 'player') stopPlayer();

  dom.searchInput.value = route.name === 'search' ? route.q : '';
  dom.searchClear.classList.toggle('hidden', !dom.searchInput.value);

  const views = { home: renderHome, search: renderSearch, title: renderTitle, player: renderPlayer };
  views[route.name](route, prev);
}

function showView(name) {
  for (const [key, el] of Object.entries(dom.views)) el.classList.toggle('active', key === name);
}

function restoreScroll(route, fallback = 0) {
  const y = scrollPositions.get(route.hash) ?? fallback;
  requestAnimationFrame(() => window.scrollTo(0, y));
}

const isCurrent = (route) => current === route;

// ─── API ───

async function fetchJSON(url, { retried = false } = {}) {
  const res = await fetch(url);
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && data.challenge && !retried) {
    await ensureVerified(data.challenge);
    return fetchJSON(url, { retried: true });
  }
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

// Memoized per page load, so back/forward and revisits render instantly.
const apiCache = new Map();
function api(url) {
  if (!apiCache.has(url)) {
    apiCache.set(url, fetchJSON(url).catch((err) => {
      apiCache.delete(url);
      throw err;
    }));
  }
  return apiCache.get(url);
}

const detailsUrl = (type, id) => `/api/${type}/${id}`;
const seasonUrl = (id, season) => `/api/tv/${id}/season/${season}`;
const playableSeasons = (data) =>
  (data?.seasons || []).filter((s) => s.season_number > 0).sort((a, b) => a.season_number - b.season_number);

// ─── TURNSTILE ───

// One challenge at a time: parallel requests that all get a 401 share it.
let verifying = null;
let turnstileScript = null;

function loadTurnstile() {
  turnstileScript ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    s.async = true;
    s.onload = () => resolve(window.turnstile);
    s.onerror = () => { turnstileScript = null; reject(new Error('Could not load the verification check')); };
    document.head.appendChild(s);
  });
  return turnstileScript;
}

function ensureVerified(siteKey) {
  verifying ??= (async () => {
    const turnstile = await loadTurnstile();
    dom.verifyOverlay.classList.remove('hidden');
    try {
      const token = await new Promise((resolve, reject) => {
        dom.verifyWidget.innerHTML = '';
        turnstile.render(dom.verifyWidget, {
          sitekey: siteKey,
          theme: 'dark',
          callback: resolve,
          'error-callback': () => reject(new Error('Verification failed, please reload')),
          'expired-callback': () => reject(new Error('Verification expired, please retry')),
        });
      });
      const res = await fetch('/api/session', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      if (!res.ok) throw new Error('Verification failed, please reload');
    } finally {
      dom.verifyOverlay.classList.add('hidden');
      dom.verifyWidget.innerHTML = '';
    }
  })().finally(() => { verifying = null; });
  return verifying;
}

// ─── CONTINUE WATCHING ───

const HISTORY_KEY = 'flix:history';
const HISTORY_MAX = 20;
const itemKey = (item) => `${item.media_type}:${item.id}`;

function readHistory() {
  try {
    const list = JSON.parse(localStorage.getItem(HISTORY_KEY));
    return Array.isArray(list)
      ? list.filter((e) => e && toInt(e.id) && (e.media_type === 'movie' || e.media_type === 'tv'))
      : [];
  } catch {
    return [];
  }
}

function writeHistory(list) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(0, HISTORY_MAX)));
  } catch { /* storage full or blocked */ }
}

// One entry per movie or series, most recent first; a series keeps its latest episode.
function recordWatch(entry) {
  const list = readHistory();
  const key = itemKey(entry);
  const prev = list.find((e) => itemKey(e) === key) || {};
  const clean = Object.fromEntries(Object.entries(entry).filter(([, v]) => v != null && v !== ''));
  writeHistory([{ ...prev, ...clean, ts: Date.now() }, ...list.filter((e) => itemKey(e) !== key)]);
}

function removeWatch(key) {
  writeHistory(readHistory().filter((e) => itemKey(e) !== key));
}

const historyEntry = (type, id) => readHistory().find((e) => e.media_type === type && e.id === id);

// ─── SHARED PIECES ───

function cardHTML(item, { sub, accent = false, to, removable = false, eager = false } = {}) {
  const type = item.media_type;
  const title = titleOf(item);
  const subtitle = sub ?? [yearOf(item), typeLabel(type)].filter(Boolean).join(' · ');
  return `
    <div class="card">
      <a class="card-link" href="${to || href.title(type, item.id)}" data-type="${type}" data-id="${item.id}">
        <div class="card-poster">
          ${imgHTML(item.poster_path, title, { sizes: '(max-width: 520px) 45vw, 186px', eager })}
          <span class="card-play">${icon('play')}</span>
        </div>
        <div class="card-title">${escape(title)}</div>
        <div class="card-sub${accent ? ' card-sub--accent' : ''}">${escape(subtitle)}</div>
      </a>
      ${removable ? `<button class="card-remove" type="button" data-remove="${escape(itemKey(item))}" aria-label="Remove ${escape(title)} from Continue watching">${icon('x')}</button>` : ''}
    </div>`;
}

const skeletonCards = (n) => Array.from({ length: n }, () => `
  <div class="card" aria-hidden="true">
    <div class="skel skel-poster"></div>
    <div class="skel skel-line"></div>
    <div class="skel skel-line skel-line--short"></div>
  </div>`).join('');

function stateHTML(title, text, action) {
  return `
    <div class="state">
      <p class="state-title">${escape(title)}</p>
      ${text ? `<p>${escape(text)}</p>` : ''}
      ${action ? `<button class="btn btn-ghost btn-sm" type="button" data-action="${action}">Try again</button>` : ''}
    </div>`;
}

function episodeHTML(tvId, season, ep, { current = false, replace = false } = {}) {
  const name = ep.name || `Episode ${ep.episode_number}`;
  const upcoming = isFuture(ep.air_date);
  const meta = upcoming
    ? `Airs ${fmtDate(ep.air_date)}`
    : [fmtDate(ep.air_date), fmtRuntime(ep.runtime)].filter(Boolean).join(' · ');
  return `
    <a class="episode" href="${href.watch('tv', tvId, season, ep.episode_number)}"${current ? ' aria-current="true"' : ''}${replace ? ' data-replace' : ''}>
      <div class="episode-thumb">
        ${imgHTML(ep.still_path, name, { kind: 'still', sizes: '200px' })}
        <span class="card-play">${icon('play')}</span>
      </div>
      <div class="episode-body">
        <div class="episode-name"><span class="episode-num">E${ep.episode_number}</span>${escape(name)}</div>
        ${meta ? `<div class="episode-meta">${escape(meta)}</div>` : ''}
        ${ep.overview ? `<p class="episode-overview">${escape(ep.overview)}</p>` : ''}
      </div>
    </a>`;
}

const skeletonEpisodes = (n) => Array.from({ length: n }, () => `
  <div class="skel-episode" aria-hidden="true">
    <div class="skel skel-thumb"></div>
    <div><div class="skel skel-line"></div><div class="skel skel-line skel-line--short"></div></div>
  </div>`).join('');

function seasonPillsHTML(seasons, active, { asLinks, tvId }) {
  return seasons.map((s) => {
    const label = `Season ${s.season_number}`;
    const on = s.season_number === active;
    return asLinks
      ? `<a class="pill" href="${href.title('tv', tvId, s.season_number)}" data-replace aria-current="${on}">${label}</a>`
      : `<button class="pill" type="button" data-player-season="${s.season_number}" aria-pressed="${on}">${label}</button>`;
  }).join('');
}

// ─── HOME ───

let homeBuilt = false;

const ROWS = [
  { id: 'trending', title: 'Trending now', url: '/api/trending' },
  { id: 'movies', title: 'Popular movies', url: '/api/trending?type=movie' },
  { id: 'series', title: 'Popular series', url: '/api/trending?type=tv' },
];

function rowHTML(id, title, inner) {
  return `
    <section class="row" id="row-${id}" aria-labelledby="row-${id}-title">
      <div class="row-head">
        <h2 class="row-title" id="row-${id}-title">${escape(title)}</h2>
        <div class="row-nav">
          <button class="icon-btn" type="button" data-scroll="-1" aria-label="Scroll left" disabled>${icon('left')}</button>
          <button class="icon-btn" type="button" data-scroll="1" aria-label="Scroll right">${icon('right')}</button>
        </div>
      </div>
      <div class="row-track">${inner}</div>
    </section>`;
}

function renderHome(route) {
  showView('home');
  document.title = 'Flix';
  if (!homeBuilt) buildHome();
  else renderContinueRow();
  restoreScroll(route);
}

async function buildHome() {
  homeBuilt = true;
  const el = dom.views.home;
  el.innerHTML = `
    <div class="hero is-loading" id="home-hero">
      <div class="hero-content"><div class="hero-inner">
        <div class="skel skel-title"></div>
        <div class="skel skel-text"></div>
        <div class="skel skel-text"></div>
        <div class="skel skel-text skel-line--short"></div>
      </div></div>
    </div>
    <div class="rows">
      <div id="row-continue-slot"></div>
      ${ROWS.map((r) => rowHTML(r.id, r.title, skeletonCards(8))).join('')}
    </div>`;
  renderContinueRow();

  const results = await Promise.allSettled(ROWS.map((r) => api(r.url)));
  if (results.every((r) => r.status === 'rejected')) {
    homeBuilt = false;
    el.innerHTML = `<div class="page">${stateHTML("Couldn't load Flix", results[0].reason.message, 'retry-home')}</div>`;
    return;
  }

  const trending = results[0].status === 'fulfilled' ? results[0].value.results : [];
  const featured = trending.find((i) => i.backdrop_path) || null;
  renderHero(featured);

  ROWS.forEach((row, i) => {
    const section = $(`#row-${row.id}`, el);
    const res = results[i];
    const track = $('.row-track', section);
    if (res.status === 'rejected') {
      track.innerHTML = `<p class="page-sub">Couldn't load this row.</p>`;
      return;
    }
    const items = res.value.results.filter((item) => !(i === 0 && featured && item.id === featured.id));
    if (!items.length) {
      section.remove();
      return;
    }
    track.innerHTML = items.map((item, n) => cardHTML(item, { eager: i === 0 && n < 6 })).join('');
    fadeIn(track);
    updateRowNav(section);
  });
}

function renderHero(item) {
  const hero = $('#home-hero');
  if (!hero) return;
  if (!item) {
    hero.remove();
    $('.rows', dom.views.home).classList.add('rows-top');
    return;
  }
  const type = item.media_type;
  const title = titleOf(item);
  const entry = historyEntry(type, item.id);
  const playTo = type === 'movie'
    ? href.watch('movie', item.id)
    : href.watch('tv', item.id, entry?.season || 1, entry?.episode || 1);
  hero.classList.remove('is-loading');
  hero.innerHTML = `
    ${imgHTML(item.backdrop_path, '', { kind: 'backdrop', sizes: '100vw', eager: true, cls: 'hero-bg' })}
    <div class="hero-content"><div class="hero-inner">
      <div class="eyebrow">#1 trending this week</div>
      <h1 class="hero-title">${escape(title)}</h1>
      <div class="meta">
        ${ratingHTML(item.vote_average)}
        ${yearOf(item) ? `<span>${yearOf(item)}</span>` : ''}
        <span>${typeLabel(type)}</span>
      </div>
      ${item.overview ? `<p class="hero-overview">${escape(item.overview)}</p>` : ''}
      <div class="actions">
        <a class="btn btn-primary" href="${playTo}">${icon('play')}${entry && type === 'tv' ? `Continue S${entry.season} · E${entry.episode}` : 'Play'}</a>
        <a class="btn btn-ghost" href="${href.title(type, item.id)}">${icon('info')}More info</a>
      </div>
    </div></div>`;
  fadeIn(hero);
}

function renderContinueRow() {
  const slot = $('#row-continue-slot');
  if (!slot) return;
  const list = readHistory();
  if (!list.length) {
    slot.innerHTML = '';
    return;
  }
  const cards = list.map((e) => {
    const isTv = e.media_type === 'tv' && e.season && e.episode;
    return cardHTML(e, {
      sub: isTv ? `S${e.season} · E${e.episode}` : 'Resume',
      accent: true,
      to: isTv ? href.watch('tv', e.id, e.season, e.episode) : href.watch('movie', e.id),
      removable: true,
    });
  }).join('');
  slot.innerHTML = rowHTML('continue', 'Continue watching', cards);
  fadeIn(slot);
  updateRowNav($('#row-continue', slot));
}

function updateRowNav(section) {
  const track = $('.row-track', section);
  const [prevBtn, nextBtn] = $$('[data-scroll]', section);
  if (!track || !prevBtn) return;
  const max = track.scrollWidth - track.clientWidth - 2;
  prevBtn.disabled = track.scrollLeft <= 2;
  nextBtn.disabled = track.scrollLeft >= max;
}

// ─── SEARCH ───

const search = { q: null, page: 0, totalPages: 0, keys: new Set(), loading: false };

function renderSearch(route) {
  showView('search');
  document.title = `${route.q} – Flix`;
  if (search.q === route.q) {
    restoreScroll(route);
    return;
  }
  window.scrollTo(0, 0);
  runSearch(route.q);
}

async function runSearch(q) {
  Object.assign(search, { q, page: 0, totalPages: 0, keys: new Set(), loading: true });
  const el = dom.views.search;
  el.innerHTML = `
    <div class="page">
      <div class="page-head">
        <h1 class="page-title">Results for “${escape(q)}”</h1>
        <span class="page-sub" id="search-count"></span>
      </div>
      <div class="grid" id="search-grid">${skeletonCards(12)}</div>
      <div class="load-more hidden" id="search-more-wrap">
        <button class="btn btn-ghost" type="button" data-action="load-more">Load more</button>
      </div>
    </div>`;

  try {
    const data = await api(`/api/search?q=${encodeURIComponent(q)}`);
    if (search.q !== q) return;
    $('#search-grid', el).innerHTML = '';
    appendResults(data);
  } catch (err) {
    if (search.q !== q) return;
    search.q = null;
    $('#search-grid', el).outerHTML = stateHTML("Search didn't work", err.message, 'retry-search');
  } finally {
    if (search.q === q) search.loading = false;
  }
}

function appendResults(data) {
  const grid = $('#search-grid');
  const fresh = (data.results || []).filter((r) => !search.keys.has(itemKey(r)));
  fresh.forEach((r) => search.keys.add(itemKey(r)));
  const offset = grid.childElementCount;
  grid.insertAdjacentHTML('beforeend', fresh.map((item, i) => cardHTML(item, { eager: offset + i < 6 })).join(''));
  fadeIn(grid);

  search.page = data.page || 1;
  search.totalPages = data.total_pages || 1;
  const total = search.keys.size;
  $('#search-count').textContent = total ? `${total}${search.page < search.totalPages ? '+' : ''} titles` : '';
  $('#search-more-wrap').classList.toggle('hidden', search.page >= search.totalPages);

  if (!total) {
    grid.outerHTML = stateHTML(`No matches for “${search.q}”`, 'Check the spelling or try another title.');
  }
}

async function loadMore(btn) {
  if (search.loading || search.page >= search.totalPages) return;
  const q = search.q;
  search.loading = true;
  btn.disabled = true;
  btn.textContent = 'Loading…';
  try {
    const data = await api(`/api/search?q=${encodeURIComponent(q)}&page=${search.page + 1}`);
    if (search.q === q) appendResults(data);
    btn.textContent = 'Load more';
  } catch {
    btn.textContent = 'Try again';
  } finally {
    btn.disabled = false;
    search.loading = false;
  }
}

// ─── TITLE PAGE ───

const titlePage = { key: null, data: null, season: null };

async function renderTitle(route, prev) {
  showView('title');
  const key = `${route.type}:${route.id}`;
  const el = dom.views.title;

  if (titlePage.key === key && titlePage.data) {
    // Same title (e.g. switching seasons or coming back from the player).
    document.title = `${titleOf(titlePage.data)} – Flix`;
    if (prev?.name === 'player') {
      // Redraw so "Continue S·E" and the current-episode marker are up to date.
      el.innerHTML = titleHTML(route.type, titlePage.data);
      fadeIn(el);
      titlePage.season = null;
    }
    if (route.type === 'tv') showTitleSeason(route);
    if (prev?.name !== 'title') restoreScroll(route);
    return;
  }

  Object.assign(titlePage, { key, data: null, season: null });
  window.scrollTo(0, 0);
  el.innerHTML = `
    <div class="title-hero">
      <button class="back-btn title-back" type="button" data-action="back">${icon('back')}Back</button>
      <div class="title-layout">
        <div class="title-poster skel"></div>
        <div class="title-info hero-inner">
          <div class="skel skel-title"></div>
          <div class="skel skel-text"></div>
          <div class="skel skel-text skel-line--short"></div>
        </div>
      </div>
    </div>
    <div class="title-body"></div>`;

  let data;
  try {
    data = await api(detailsUrl(route.type, route.id));
  } catch (err) {
    if (!isCurrent(route)) return;
    titlePage.key = null;
    el.innerHTML = `<div class="page">${stateHTML(err.message === 'Not found' ? "We couldn't find that title" : "Couldn't load this title", err.message, 'retry-title')}</div>`;
    return;
  }
  if (!isCurrent(route)) return;
  titlePage.data = data;
  document.title = `${titleOf(data)} – Flix`;
  el.innerHTML = titleHTML(route.type, data);
  fadeIn(el);
  if (route.type === 'tv') showTitleSeason(route);
}

function titleHTML(type, data) {
  const name = titleOf(data);
  const year = type === 'tv'
    ? [yearOf(data), data.status === 'Ended' && data.last_air_date ? data.last_air_date.slice(0, 4) : ''].filter(Boolean).join('–')
    : yearOf(data);
  const length = type === 'tv'
    ? (data.number_of_seasons ? `${data.number_of_seasons} season${data.number_of_seasons > 1 ? 's' : ''}` : '')
    : fmtRuntime(data.runtime);

  let play = '';
  if (type === 'movie') {
    play = `<a class="btn btn-primary" href="${href.watch('movie', data.id)}">${icon('play')}Play</a>`;
  } else {
    const seasons = playableSeasons(data);
    const entry = historyEntry('tv', data.id);
    if (entry?.season && entry?.episode) {
      play = `<a class="btn btn-primary" href="${href.watch('tv', data.id, entry.season, entry.episode)}">${icon('play')}Continue S${entry.season} · E${entry.episode}</a>`;
    } else if (seasons.length) {
      play = `<a class="btn btn-primary" href="${href.watch('tv', data.id, seasons[0].season_number, 1)}">${icon('play')}Play S${seasons[0].season_number} · E1</a>`;
    }
  }

  return `
    <div class="title-hero">
      ${imgHTML(data.backdrop_path, '', { kind: 'backdrop', sizes: '100vw', eager: true, cls: 'hero-bg' })}
      <button class="back-btn title-back" type="button" data-action="back">${icon('back')}Back</button>
      <div class="title-layout">
        <div class="title-poster">${imgHTML(data.poster_path, name, { sizes: '240px', eager: true })}</div>
        <div class="title-info">
          <h1 class="title-name">${escape(name)}</h1>
          ${data.tagline ? `<p class="tagline">${escape(data.tagline)}</p>` : ''}
          <div class="meta">
            ${ratingHTML(data.vote_average)}
            ${year ? `<span>${year}</span>` : ''}
            ${length ? `<span>${length}</span>` : ''}
            <span>${typeLabel(type)}</span>
          </div>
          ${data.genres?.length ? `<div class="chips">${data.genres.map((g) => `<span class="chip">${escape(g)}</span>`).join('')}</div>` : ''}
          ${data.overview ? `<p class="overview">${escape(data.overview)}</p>` : ''}
          ${play ? `<div class="actions">${play}</div>` : ''}
        </div>
      </div>
    </div>
    <div class="title-body">
      ${type === 'tv' ? `
        <div class="section-head">
          <h2 class="section-title">Episodes</h2>
          <div class="pills" id="title-seasons"></div>
        </div>
        <div class="episodes" id="title-episodes"></div>` : ''}
    </div>`;
}

async function showTitleSeason(route) {
  const data = titlePage.data;
  const seasons = playableSeasons(data);
  const list = $('#title-episodes');
  if (!list) return;
  if (!seasons.length) {
    list.innerHTML = stateHTML('No episodes yet', 'Check back when the first season airs.');
    return;
  }

  const entry = historyEntry('tv', data.id);
  const wanted = route.season || entry?.season || seasons[0].season_number;
  const season = seasons.some((s) => s.season_number === wanted) ? wanted : seasons[0].season_number;
  $('#title-seasons').innerHTML = seasonPillsHTML(seasons, season, { asLinks: true, tvId: data.id });
  if (titlePage.season === season && list.childElementCount) return;
  titlePage.season = season;

  list.innerHTML = skeletonEpisodes(6);
  try {
    const { episodes = [] } = await api(seasonUrl(data.id, season));
    if (!isCurrent(route) || titlePage.season !== season) return;
    const currentEp = entry?.season === season ? entry.episode : null;
    list.innerHTML = episodes.length
      ? episodes.map((ep) => episodeHTML(data.id, season, ep, { current: ep.episode_number === currentEp })).join('')
      : stateHTML('No episodes in this season yet');
    fadeIn(list);
  } catch (err) {
    if (titlePage.season !== season) return;
    titlePage.season = null;
    list.innerHTML = stateHTML("Couldn't load episodes", err.message, 'retry-season');
  }
}

// ─── PLAYER ───

const player = { key: null, data: null, sourceIndex: 0, listSeason: null };

function renderPlayer(route) {
  showView('player');
  window.scrollTo(0, 0);
  const el = dom.views.player;
  const key = `${route.type}:${route.id}`;

  if (!$('.player-page', el)) {
    el.innerHTML = `
      <div class="player-page">
        <div class="player-head">
          <button class="icon-btn" type="button" data-action="back" aria-label="Back">${icon('back')}</button>
          <div class="player-titles">
            <h1 class="player-title" id="player-title"></h1>
            <p class="player-sub" id="player-sub"></p>
          </div>
        </div>
        <div class="player-frame" id="player-frame"></div>
        <div class="player-bar">
          <span class="player-bar-label">Server</span>
          <div class="pills" id="player-sources"></div>
          <a class="btn btn-ghost btn-sm hidden" id="player-next" data-replace aria-keyshortcuts="n">Next episode${icon('next')}</a>
        </div>
        <p class="player-hint">Video not loading? Try another server.</p>
        <div class="player-episodes" id="player-episodes"></div>
      </div>`;
  }

  if (player.key !== key) {
    Object.assign(player, { key, data: null, listSeason: null });
    $('#player-title').textContent = ' ';
    $('#player-sub').textContent = '';
    $('#player-episodes').innerHTML = '';
  }

  renderSources();
  loadSource(route);
  $('#player-next').classList.add('hidden');
  recordWatch(route.type === 'tv'
    ? { media_type: 'tv', id: route.id, season: route.season, episode: route.episode }
    : { media_type: 'movie', id: route.id });

  fillPlayer(route);
}

async function fillPlayer(route) {
  let data = player.data;
  if (!data) {
    try {
      data = await api(detailsUrl(route.type, route.id));
    } catch {
      if (isCurrent(route)) $('#player-title').textContent = typeLabel(route.type);
      return;
    }
    if (!isCurrent(route)) return;
    player.data = data;
  }

  const name = titleOf(data);
  $('#player-title').textContent = name;
  recordWatch(route.type === 'tv'
    ? { media_type: 'tv', id: route.id, name, poster_path: data.poster_path }
    : { media_type: 'movie', id: route.id, title: name, poster_path: data.poster_path });

  if (route.type === 'movie') {
    $('#player-sub').textContent = [yearOf(data), fmtRuntime(data.runtime)].filter(Boolean).join(' · ');
    document.title = `${name} – Flix`;
    return;
  }

  document.title = `${name} S${route.season}E${route.episode} – Flix`;
  $('#player-sub').textContent = `Season ${route.season} · Episode ${route.episode}`;
  await showPlayerSeason(route, route.season);

  const eps = await seasonEpisodes(route.id, route.season).catch(() => []);
  if (!isCurrent(route)) return;
  const ep = eps.find((e) => e.episode_number === route.episode);
  if (ep?.name) $('#player-sub').textContent = `S${route.season} · E${route.episode} — ${ep.name}`;
  updateNext(route, eps);
}

const seasonEpisodes = (id, season) => api(seasonUrl(id, season)).then((d) => d.episodes || []);

async function showPlayerSeason(route, season) {
  const box = $('#player-episodes');
  const seasons = playableSeasons(player.data);
  if (!seasons.length) return;
  if (!$('#player-seasons', box)) {
    box.innerHTML = `
      <div class="section-head">
        <h2 class="section-title">Episodes</h2>
        <div class="pills" id="player-seasons"></div>
      </div>
      <div class="episodes" id="player-episode-list"></div>`;
  }
  $('#player-seasons').innerHTML = seasonPillsHTML(seasons, season, { asLinks: false });
  const list = $('#player-episode-list');
  if (player.listSeason !== season) list.innerHTML = skeletonEpisodes(4);
  player.listSeason = season;

  try {
    const eps = await seasonEpisodes(route.id, season);
    if (!isCurrent(route) || player.listSeason !== season) return;
    list.innerHTML = eps.map((ep) => episodeHTML(route.id, season, ep, {
      current: season === route.season && ep.episode_number === route.episode,
      replace: true,
    })).join('') || stateHTML('No episodes in this season yet');
    fadeIn(list);
  } catch (err) {
    if (player.listSeason === season) list.innerHTML = stateHTML("Couldn't load episodes", err.message);
  }
}

// Next aired episode in this season, else the first episode of the next season.
async function updateNext(route, eps) {
  const next = $('#player-next');
  const idx = eps.findIndex((e) => e.episode_number === route.episode);
  let target = null;
  if (idx >= 0 && idx + 1 < eps.length && !isFuture(eps[idx + 1].air_date)) {
    target = { season: route.season, episode: eps[idx + 1].episode_number };
  } else if (idx >= 0 && idx + 1 >= eps.length) {
    const nextSeason = playableSeasons(player.data).find((s) => s.season_number > route.season);
    if (nextSeason) {
      const nextEps = await seasonEpisodes(route.id, nextSeason.season_number).catch(() => []);
      if (nextEps[0] && !isFuture(nextEps[0].air_date)) {
        target = { season: nextSeason.season_number, episode: nextEps[0].episode_number };
      }
    }
  }
  if (!isCurrent(route)) return;
  next.classList.toggle('hidden', !target);
  if (target) next.href = href.watch('tv', route.id, target.season, target.episode);
}

function renderSources() {
  $('#player-sources').innerHTML = SOURCES.map((s, i) =>
    `<button class="pill" type="button" data-source="${i}" aria-pressed="${i === player.sourceIndex}">${escape(s.name)}</button>`).join('');
}

function loadSource(route) {
  const src = SOURCES[player.sourceIndex];
  setPlayerSrc(route.type === 'tv' ? src.tv(route.id, route.season, route.episode) : src.movie(route.id));
}

// Changing an existing iframe's src adds a browser-history entry, so Back
// would step the embed back instead of leaving the player. A freshly inserted
// iframe's first navigation adds no entry, so insert a new one per load.
function setPlayerSrc(url) {
  const frame = $('#player-frame');
  if (!frame) return;
  frame.innerHTML = '';
  if (!url) return;
  const iframe = document.createElement('iframe');
  iframe.src = url;
  iframe.title = 'Video player';
  iframe.allow = 'autoplay; fullscreen; encrypted-media; picture-in-picture';
  iframe.allowFullscreen = true;
  frame.appendChild(iframe);
}

function stopPlayer() {
  setPlayerSrc(null);
}

// ─── EVENTS ───

dom.searchForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const q = dom.searchInput.value.trim().slice(0, 100);
  if (!q) return;
  dom.searchInput.blur();
  navigate(href.search(q));
});

dom.searchInput.addEventListener('input', () => {
  dom.searchClear.classList.toggle('hidden', !dom.searchInput.value);
});

dom.searchClear.addEventListener('click', () => {
  dom.searchInput.value = '';
  dom.searchClear.classList.add('hidden');
  dom.searchInput.focus();
});

document.addEventListener('click', (e) => {
  const replaceLink = e.target.closest('a[data-replace]');
  if (replaceLink && !e.ctrlKey && !e.metaKey && !e.shiftKey && e.button === 0) {
    e.preventDefault();
    navigate(replaceLink.getAttribute('href'), { replace: true });
    return;
  }

  const remove = e.target.closest('[data-remove]');
  if (remove) {
    removeWatch(remove.dataset.remove);
    renderContinueRow();
    return;
  }

  const scroll = e.target.closest('[data-scroll]');
  if (scroll) {
    const track = $('.row-track', scroll.closest('.row'));
    track.scrollBy({ left: Number(scroll.dataset.scroll) * track.clientWidth * 0.85, behavior: 'smooth' });
    return;
  }

  const source = e.target.closest('[data-source]');
  if (source && current?.name === 'player') {
    player.sourceIndex = Number(source.dataset.source);
    renderSources();
    loadSource(current);
    return;
  }

  const playerSeason = e.target.closest('[data-player-season]');
  if (playerSeason && current?.name === 'player') {
    showPlayerSeason(current, Number(playerSeason.dataset.playerSeason));
    return;
  }

  const action = e.target.closest('[data-action]')?.dataset.action;
  if (!action) return;
  if (action === 'back') goBack();
  else if (action === 'load-more') loadMore(e.target.closest('button'));
  else if (action === 'retry-search') { search.q = null; renderSearch(current); }
  else if (action === 'retry-home') { homeBuilt = false; renderHome(current); }
  else if (action === 'retry-title') { titlePage.key = null; renderTitle(current); }
  else if (action === 'retry-season') { titlePage.season = null; showTitleSeason(current); }
});

// Row arrows follow the scroll position.
document.addEventListener('scroll', (e) => {
  if (e.target instanceof Element && e.target.classList.contains('row-track')) {
    updateRowNav(e.target.closest('.row'));
  }
}, { capture: true, passive: true });

// Warm the cache when the pointer heads for a title.
document.addEventListener('pointerover', (e) => {
  const link = e.target.closest?.('.card-link[data-type]');
  if (link && !verifying) api(detailsUrl(link.dataset.type, link.dataset.id)).catch(() => {});
}, { passive: true });

const onScroll = () => dom.topbar.classList.toggle('is-scrolled', window.scrollY > 8);
window.addEventListener('scroll', onScroll, { passive: true });

document.addEventListener('keydown', (e) => {
  const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
  if (e.ctrlKey || e.metaKey || e.altKey) return;

  if (e.key === '/' && !typing) {
    e.preventDefault();
    dom.searchInput.focus();
    dom.searchInput.select();
  } else if (e.key === 'Escape') {
    if (typing) dom.searchInput.blur();
    else if (current?.name !== 'home') goBack();
  } else if ((e.key === 'n' || e.key === 'N') && !typing && current?.name === 'player') {
    const next = $('#player-next');
    if (!next.classList.contains('hidden')) next.click();
  }
});

window.addEventListener('hashchange', onRoute);

// ─── INIT ───

if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
onScroll();
onRoute();
