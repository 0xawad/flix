const IMG_BASE = 'https://image.tmdb.org/t/p';

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

const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

const dom = {
  searchFab: $('#search-fab'),
  verifyOverlay: $('#verify-overlay'),
  verifyWidget: $('#verify-widget'),
  searchBar: $('#search-bar'),
  searchBackdrop: $('#search-backdrop'),
  searchInput: $('#search-input'),
  searchClear: $('#search-clear'),
  searchClose: $('#search-close'),
  resultsView: $('#results-view'),
  resultsGrid: $('#results-grid'),
  resultsLabel: $('#results-label'),
  resultsCount: $('#results-count'),
  resultsEmpty: $('#results-empty'),
  resultsLoading: $('#results-loading'),
  resultsError: $('#results-error'),
  resultsErrorMsg: $('#results-error-msg'),
  resultsRetry: $('#results-retry'),
  tvView: $('#tv-view'),
  tvBack: $('#tv-back'),
  tvPoster: $('#tv-poster'),
  tvTitle: $('#tv-title'),
  tvOverview: $('#tv-overview'),
  seasonSelect: $('#season-select'),
  episodesList: $('#episodes-list'),
  tvLoading: $('#tv-loading'),
  playerView: $('#player-view'),
  playerBack: $('#player-back'),
  playerMeta: $('#player-meta'),
  playerIframe: $('#player-iframe'),
  playerEpisodes: $('#player-episodes'),
  playerEpisodesList: $('#player-episodes-list'),
  seasonTabs: $('#season-tabs'),
  sourceButtons: $('#source-buttons'),
  playerNext: $('#player-next'),
  continueRow: $('#continue-row'),
  continueGrid: $('#continue-grid'),
  resultsMoreWrap: $('#results-more-wrap'),
  resultsMore: $('#results-more'),
};

let lastQuery = '';
let seriesData = null;
let currentSeasonEpisodes = [];
let currentSeasonNum = null;
let seasonLoadGeneration = 0;
let allSeasonEpisodes = new Map();
let availableSeasons = [];
let activePlayerSeason = null;
let currentSourceIndex = 0;
let currentPlayerId = null;
let currentPlayerSeason = null;
let currentPlayerEpisode = null;
let fallbackTimer = null;
let currentPlayerPoster = null;
let searchPage = 1;
let searchTotalPages = 1;
const shownKeys = new Set();

function showView(view) {
  $$('.view').forEach((v) => v.classList.remove('active'));
  view.classList.remove('hidden');
  view.classList.add('active');
}

function posterUrl(path, size = 'w342') {
  return path ? `${IMG_BASE}/${size}${path}` : null;
}

// Grid cards are ~130-250px wide (two columns on phones), so let the browser
// pick the smallest TMDB size that is sharp at the device's pixel ratio.
function posterImg(path, alt, { sizes = '(max-width: 600px) 50vw, 200px', eager = false } = {}) {
  if (!path) return '<div class="no-poster">No poster</div>';
  const srcset = ['w185 185w', 'w342 342w', 'w500 500w']
    .map((s) => { const [size, w] = s.split(' '); return `${posterUrl(path, size)} ${w}`; })
    .join(', ');
  return `<img src="${posterUrl(path)}" srcset="${srcset}" sizes="${sizes}" alt="${escape(alt)}"`
    + ` ${eager ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async">`;
}

function renderPoster(el, path, alt) {
  el.innerHTML = posterImg(path, alt, { sizes: '140px', eager: true });
}

function escape(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function fetchJSON(url, { retried = false } = {}) {
  const res = await fetch(url);
  const data = await res.json();
  if (res.status === 401 && data.challenge && !retried) {
    await ensureVerified(data.challenge);
    return fetchJSON(url, { retried: true });
  }
  if (!res.ok) throw new Error(data.error || data.status_message || `Request failed (${res.status})`);
  return data;
}

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

function isActive(view) {
  return view.classList.contains('active');
}

function toInt(val) {
  const n = Number(val);
  return Number.isInteger(n) && n > 0 ? n : null;
}

// Builds the hash for the current state. The player's own ids are the source
// of truth, so movies and episodes always produce a correct, shareable URL.
function currentRoute() {
  if (isActive(dom.playerView) && currentPlayerId != null) {
    if (currentPlayerSeason != null && currentPlayerEpisode != null) {
      return `#/tv/${currentPlayerId}/watch/${currentPlayerSeason}/${currentPlayerEpisode}`;
    }
    return `#/movie/${currentPlayerId}/watch`;
  }
  if (isActive(dom.tvView) && seriesData) {
    return currentSeasonNum != null
      ? `#/tv/${seriesData.id}/season/${currentSeasonNum}`
      : `#/tv/${seriesData.id}`;
  }
  if (isActive(dom.resultsView) && lastQuery) {
    return `#/search/${encodeURIComponent(lastQuery)}`;
  }
  return '#/';
}

// pushState/replaceState don't fire `hashchange`, so updating the URL after an
// in-app navigation no longer re-runs handleRoute (which double-loaded the
// player). Back/forward still fire `hashchange` and go through handleRoute.
function updateRoute({ replace = false } = {}) {
  const hash = currentRoute();
  if (location.hash === hash) return;
  history[replace ? 'replaceState' : 'pushState'](null, '', hash);
}

function leavePlayer() {
  if (isActive(dom.playerView)) closePlayer(true);
}

function handleRoute() {
  const hash = location.hash || '#/';
  const parts = hash.slice(2).split('/');

  if (parts[0] === 'search' && parts[1]) {
    const query = decodeURIComponent(parts.slice(1).join('/'));
    leavePlayer();
    if (seriesData) closeTv(true);
    dom.searchInput.value = query;
    if (query === lastQuery) showView(dom.resultsView);
    else doSearch(query, { fromRoute: true });
    return;
  }

  if (parts[0] === 'tv') {
    const id = toInt(parts[1]);
    if (!id) return goHome();

    if (parts[2] === 'watch') {
      const season = toInt(parts[3]);
      const episode = toInt(parts[4]);
      if (!season || !episode) return loadSeries(id, { fromRoute: true });
      if (isActive(dom.playerView) && currentPlayerId === id
        && currentPlayerSeason === season && currentPlayerEpisode === episode) return;
      return loadSeries(id, { season, episode, fromRoute: true });
    }

    leavePlayer();
    const season = parts[2] === 'season' ? toInt(parts[3]) : null;
    if (seriesData && seriesData.id === id) {
      showView(dom.tvView);
      if (season && currentSeasonNum !== season) {
        dom.seasonSelect.value = season;
        loadEpisodes(id, season);
      }
      return;
    }
    return loadSeries(id, { season, fromRoute: true });
  }

  if (parts[0] === 'movie' && parts[2] === 'watch') {
    const id = toInt(parts[1]);
    if (!id) return goHome();
    if (isActive(dom.playerView) && currentPlayerId === id && currentPlayerSeason == null) return;
    seriesData = null;
    currentPlayerPoster = null;
    openPlayer(id, 'Loading...', undefined, undefined, true);
    fetchJSON(`/api/movie/${id}`)
      .then((data) => {
        if (currentPlayerId === id && currentPlayerSeason == null) {
          dom.playerMeta.textContent = data.title || 'Untitled';
          currentPlayerPoster = data.poster_path || null;
          recordCurrentWatch();
        }
      })
      .catch(() => {});
    return;
  }

  goHome();
}

function goHome() {
  leavePlayer();
  if (seriesData) closeTv(true);
  if (lastQuery || !isActive(dom.resultsView) || dom.resultsGrid.childElementCount === 0) {
    lastQuery = '';
    dom.searchInput.value = '';
    dom.searchClear.classList.add('hidden');
    loadTrending();
  }
  updateRoute({ replace: true });
}

// ─── SEARCH BAR ───

function openSearch() {
  dom.searchBar.classList.add('is-active');
  dom.searchBackdrop.classList.add('is-active');
  dom.searchFab.classList.add('is-hidden');
  dom.searchInput.focus();
}

function closeSearch() {
  dom.searchBar.classList.remove('is-active');
  dom.searchBackdrop.classList.remove('is-active');
  dom.searchFab.classList.remove('is-hidden');
}

async function doSearch(query, { fromRoute = false, force = false } = {}) {
  query = query.trim().slice(0, 100);
  if (!query || (query === lastQuery && !force)) return;
  closeSearch();
  leavePlayer();
  lastQuery = query;
  seriesData = null;
  currentSeasonEpisodes = [];
  currentSeasonNum = null;
  dom.searchClear.classList.remove('hidden');

  dom.resultsLoading.classList.remove('hidden');
  dom.resultsGrid.innerHTML = '';
  dom.resultsMoreWrap.classList.add('hidden');
  renderContinue();
  dom.resultsEmpty.classList.add('hidden');
  dom.resultsError.classList.add('hidden');
  dom.resultsLabel.textContent = `Results for "${query}"`;
  dom.resultsCount.textContent = '';
  showView(dom.resultsView);
  if (!fromRoute) updateRoute();

  try {
    const data = await fetchJSON(`/api/search?q=${encodeURIComponent(query)}`);
    if (query !== lastQuery) return;
    dom.resultsLoading.classList.add('hidden');
    renderResults(data);
  } catch (err) {
    if (query !== lastQuery) return;
    dom.resultsLoading.classList.add('hidden');
    dom.resultsError.classList.remove('hidden');
    dom.resultsErrorMsg.textContent = err.message;
  }
}

async function loadTrending() {
  dom.resultsLabel.textContent = 'Trending';
  dom.resultsCount.textContent = '';
  dom.resultsLoading.classList.remove('hidden');
  dom.resultsGrid.innerHTML = '';
  dom.resultsMoreWrap.classList.add('hidden');
  dom.resultsEmpty.classList.add('hidden');
  dom.resultsError.classList.add('hidden');
  renderContinue();
  showView(dom.resultsView);

  try {
    const data = await fetchJSON('/api/trending');
    if (lastQuery) return;
    dom.resultsLoading.classList.add('hidden');
    renderResults(data);
  } catch (err) {
    if (lastQuery) return;
    dom.resultsLoading.classList.add('hidden');
    dom.resultsError.classList.remove('hidden');
    dom.resultsErrorMsg.textContent = err.message;
  }
}

const PLAY_ICON = '<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3" fill="currentColor"/></svg>';
const CLOSE_ICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';

function itemKey(item) {
  return `${item.media_type}:${item.id}`;
}

// Warm the browser cache (the API sends max-age) so opening a series is instant.
const prefetched = new Set();
function prefetchSeries(id) {
  if (prefetched.has(id)) return;
  prefetched.add(id);
  fetch(`/api/tv/${id}`, { priority: 'low' }).catch(() => prefetched.delete(id));
}

function createCard(item, { eager = false, subtitle, onSelect, onRemove } = {}) {
  const card = document.createElement('div');
  card.className = 'card';
  card.tabIndex = 0;
  card.setAttribute('role', 'button');

  const title = item.title || item.name || 'Untitled';
  const year = (item.release_date || item.first_air_date || '').slice(0, 4);
  const isMovie = item.media_type === 'movie';
  const meta = subtitle ?? year;

  card.setAttribute('aria-label', `Play ${title}${meta ? ` (${meta})` : ''}`);
  card.innerHTML = `
    <div class="card-poster">
      ${posterImg(item.poster_path, title, { eager })}
      <div class="card-overlay">
        <div class="card-play">${PLAY_ICON}</div>
        <div class="card-info">
          <div class="card-title">${escape(title)}</div>
          <div class="card-meta">${escape(meta)}${meta ? ' · ' : ''}<span class="card-tag ${isMovie ? 'card-tag--movie' : 'card-tag--tv'}">${isMovie ? 'Movie' : 'TV'}</span></div>
        </div>
      </div>
    </div>
  `;

  const select = onSelect || (() => handleSelect(item));
  card.addEventListener('click', select);
  card.addEventListener('keydown', (e) => {
    if (e.target !== card) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      select();
    }
  });
  if (!isMovie) {
    card.addEventListener('pointerenter', () => prefetchSeries(item.id), { once: true });
    card.addEventListener('focus', () => prefetchSeries(item.id), { once: true });
  }

  if (onRemove) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'card-remove';
    btn.setAttribute('aria-label', `Remove ${title} from Continue watching`);
    btn.innerHTML = CLOSE_ICON;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      onRemove();
    });
    card.appendChild(btn);
  }

  return card;
}

function renderResults(data, { append = false } = {}) {
  if (!append) {
    dom.resultsGrid.innerHTML = '';
    shownKeys.clear();
  }
  const items = (data.results || []).filter(
    (r) => (r.media_type === 'movie' || r.media_type === 'tv') && !shownKeys.has(itemKey(r))
  );

  searchPage = data.page || 1;
  searchTotalPages = data.total_pages || 1;
  dom.resultsMoreWrap.classList.toggle('hidden', !lastQuery || searchPage >= searchTotalPages);

  const offset = dom.resultsGrid.childElementCount;
  items.forEach((item, index) => {
    shownKeys.add(itemKey(item));
    dom.resultsGrid.appendChild(createCard(item, { eager: offset + index < 6 }));
  });

  const total = dom.resultsGrid.childElementCount;
  dom.resultsCount.textContent = `${total}`;
  dom.resultsEmpty.classList.toggle('hidden', total > 0);
}

async function loadMoreResults() {
  const query = lastQuery;
  if (!query || searchPage >= searchTotalPages) return;
  dom.resultsMore.disabled = true;
  dom.resultsMore.textContent = 'Loading...';
  try {
    const data = await fetchJSON(`/api/search?q=${encodeURIComponent(query)}&page=${searchPage + 1}`);
    if (query !== lastQuery) return;
    renderResults(data, { append: true });
  } catch (err) {
    dom.resultsMore.textContent = 'Retry';
    dom.resultsMore.disabled = false;
    return;
  }
  dom.resultsMore.disabled = false;
  dom.resultsMore.textContent = 'Load more';
}

// ─── CONTINUE WATCHING ───

const HISTORY_KEY = 'flix:history';
const HISTORY_MAX = 20;

function readHistory() {
  try {
    const list = JSON.parse(localStorage.getItem(HISTORY_KEY));
    return Array.isArray(list) ? list.filter((e) => e && toInt(e.id) && (e.media_type === 'movie' || e.media_type === 'tv')) : [];
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

function removeWatch(entry) {
  writeHistory(readHistory().filter((e) => itemKey(e) !== itemKey(entry)));
  renderContinue();
}

function resumeWatch(entry) {
  if (entry.media_type === 'movie') {
    seriesData = null;
    currentPlayerPoster = entry.poster_path || null;
    openPlayer(entry.id, entry.title || 'Untitled');
  } else {
    loadSeries(entry.id, { title: entry.name, season: entry.season, episode: entry.episode });
  }
}

function renderContinue() {
  const list = lastQuery ? [] : readHistory();
  dom.continueGrid.innerHTML = '';
  dom.continueRow.classList.toggle('hidden', list.length === 0);
  list.forEach((entry) => {
    const subtitle = entry.media_type === 'tv' && entry.season && entry.episode
      ? `S${entry.season} · E${entry.episode}`
      : '';
    dom.continueGrid.appendChild(createCard(entry, {
      subtitle,
      onSelect: () => resumeWatch(entry),
      onRemove: () => removeWatch(entry),
    }));
  });
}

function handleSelect(item) {
  const title = item.title || item.name || 'Untitled';
  if (item.media_type === 'movie') {
    seriesData = null;
    currentPlayerPoster = item.poster_path || null;
    openPlayer(item.id, title);
  } else {
    loadSeries(item.id, { title });
  }
}

let seriesLoadGeneration = 0;

// Single loader for the TV view, used both by clicks and by deep links.
// With `episode` set it continues straight into the player.
async function loadSeries(id, { title, season, episode, fromRoute = false } = {}) {
  const gen = ++seriesLoadGeneration;
  leavePlayer();
  seriesData = null;
  currentSeasonEpisodes = [];
  currentSeasonNum = null;
  dom.tvLoading.classList.remove('hidden');
  dom.episodesList.innerHTML = '';
  dom.seasonSelect.innerHTML = '<option value="">Loading...</option>';
  dom.tvTitle.textContent = title || '';
  dom.tvOverview.textContent = '';
  dom.tvPoster.innerHTML = '';
  showView(dom.tvView);

  try {
    const data = await fetchJSON(`/api/tv/${id}`);
    if (gen !== seriesLoadGeneration) return;
    seriesData = data;

    const name = data.name || title || 'Untitled';
    renderPoster(dom.tvPoster, data.poster_path, name);
    dom.tvTitle.textContent = name;
    dom.tvOverview.textContent = data.overview || '';

    const seasons = (data.seasons || []).filter((s) => s.season_number > 0);
    dom.seasonSelect.innerHTML = '';
    dom.tvLoading.classList.add('hidden');

    if (seasons.length === 0) {
      dom.episodesList.innerHTML = `
        <div class="state state--full">
          <p>No seasons available.</p>
        </div>`;
      if (!fromRoute) updateRoute();
      dom.tvBack.focus();
      return;
    }

    seasons.forEach((s) => {
      const opt = document.createElement('option');
      opt.value = s.season_number;
      opt.textContent = `${s.name} (${s.episode_count} eps)`;
      dom.seasonSelect.appendChild(opt);
    });

    const target = seasons.some((s) => s.season_number === season) ? season : seasons[0].season_number;
    dom.seasonSelect.value = target;
    const loading = loadEpisodes(id, target);
    if (!fromRoute) updateRoute();

    if (episode != null) {
      await loading;
      if (gen !== seriesLoadGeneration) return;
      const ep = currentSeasonEpisodes.find((e) => e.episode_number === episode);
      openPlayer(id, `${name} — ${ep?.name || `Episode ${episode}`}`, target, episode, true);
      updateRoute({ replace: true });
      return;
    }
    if (fromRoute) updateRoute({ replace: true });
    dom.tvBack.focus();
  } catch (err) {
    if (gen !== seriesLoadGeneration) return;
    dom.tvLoading.classList.add('hidden');
    dom.seasonSelect.innerHTML = '';
    dom.episodesList.innerHTML = `
      <div class="state state--full">
        <p>${escape(err.message)}</p>
      </div>`;
  }
}

async function loadEpisodes(seriesId, seasonNum) {
  seasonNum = Number(seasonNum);
  const gen = ++seasonLoadGeneration;
  currentSeasonEpisodes = [];
  currentSeasonNum = null;
  dom.episodesList.innerHTML = `
    <div class="state state--full">
      <div class="spinner"></div>
    </div>`;

  try {
    const data = await fetchJSON(`/api/tv/${seriesId}/season/${seasonNum}`);
    if (gen !== seasonLoadGeneration) return;

    const episodes = data.episodes || [];
    currentSeasonEpisodes = episodes;
    currentSeasonNum = seasonNum;
    if (isActive(dom.tvView)) updateRoute({ replace: true });

    if (episodes.length === 0) {
      dom.episodesList.innerHTML = `
        <div class="state state--full">
          <p>No episodes in this season.</p>
        </div>`;
      return;
    }

    dom.episodesList.innerHTML = '';
    episodes.forEach((ep) => {
      const el = document.createElement('div');
      el.className = 'episode';
      el.tabIndex = 0;
      el.setAttribute('role', 'button');

      const epName = ep.name || `Episode ${ep.episode_number}`;
      el.setAttribute('aria-label', `Play episode ${ep.episode_number}: ${epName}`);

      const date = ep.air_date
        ? new Date(ep.air_date).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
        : '';

      el.innerHTML = `
        <div class="episode-num">E${ep.episode_number}</div>
        <div class="episode-name">${escape(epName)}</div>
        ${date ? `<div class="episode-date">${date}</div>` : ''}
      `;

      el.addEventListener('click', () => {
        openPlayer(seriesData.id, `${seriesData.name} — ${epName}`, seasonNum, ep.episode_number);
      });
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          el.click();
        }
      });

      dom.episodesList.appendChild(el);
    });
  } catch (err) {
    if (gen !== seasonLoadGeneration) return;
    dom.episodesList.innerHTML = `
      <div class="state state--full">
        <p>${escape(err.message)}</p>
      </div>`;
  }
}

function renderPlayerEpisodeCard(ep, isActive, seasonNum) {
  const el = document.createElement('div');
  el.className = 'episode' + (isActive ? ' episode--active' : '');
  el.tabIndex = 0;
  el.setAttribute('role', 'button');

  const epName = ep.name || `Episode ${ep.episode_number}`;
  el.setAttribute('aria-label', `Play ${epName}`);

  const date = ep.air_date
    ? new Date(ep.air_date).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
    : '';

  el.innerHTML = `
    <div class="episode-num">E${ep.episode_number}</div>
    <div class="episode-name">${escape(epName)}</div>
    ${date ? `<div class="episode-date">${date}</div>` : ''}
  `;

  el.addEventListener('click', () => switchPlayerEpisode(seasonNum, ep.episode_number));
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      el.click();
    }
  });

  return el;
}

function renderSeasonTabs(activeSeason) {
  dom.seasonTabs.innerHTML = '';
  for (const s of availableSeasons) {
    const btn = document.createElement('button');
    btn.className = 'season-tab' + (s.season_number === activeSeason ? ' season-tab--active' : '');
    btn.textContent = `S${s.season_number}`;
    btn.setAttribute('aria-label', `Season ${s.season_number}`);
    btn.addEventListener('click', () => switchPlayerSeasonTab(s.season_number));
    dom.seasonTabs.appendChild(btn);
  }
}

function renderActiveSeasonEpisodes(seasonNum, activeEpNum) {
  dom.playerEpisodesList.innerHTML = '';
  const episodes = allSeasonEpisodes.get(seasonNum);
  if (!episodes) return;
  episodes.forEach((ep) => {
    dom.playerEpisodesList.appendChild(renderPlayerEpisodeCard(ep, ep.episode_number === activeEpNum, seasonNum));
  });
  const activeCard = dom.playerEpisodesList.querySelector('.episode--active');
  if (activeCard) activeCard.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  updateNextButton();
}

// ─── NEXT EPISODE ───

// The next episode in this season, else the first episode of the next season
// (episode is null until that season's list is loaded).
function nextEpisodeTarget() {
  if (currentPlayerSeason == null || currentPlayerEpisode == null) return null;
  const eps = allSeasonEpisodes.get(currentPlayerSeason) || [];
  const idx = eps.findIndex((e) => e.episode_number === currentPlayerEpisode);
  if (idx < 0) return null;
  if (idx + 1 < eps.length) {
    return { season: currentPlayerSeason, episode: eps[idx + 1].episode_number };
  }
  const next = availableSeasons.find((s) => s.season_number > currentPlayerSeason);
  return next ? { season: next.season_number, episode: null } : null;
}

function updateNextButton() {
  dom.playerNext.classList.toggle('hidden', !nextEpisodeTarget());
}

async function playNextEpisode() {
  const target = nextEpisodeTarget();
  if (!target) return;
  if (target.episode == null) {
    const id = currentPlayerId;
    if (!allSeasonEpisodes.has(target.season)) {
      try {
        const data = await fetchJSON(`/api/tv/${id}/season/${target.season}`);
        if (currentPlayerId !== id) return;
        allSeasonEpisodes.set(target.season, data.episodes || []);
      } catch { return; }
    }
    const first = allSeasonEpisodes.get(target.season)[0];
    if (!first) return;
    target.episode = first.episode_number;
  }
  switchPlayerEpisode(target.season, target.episode);
}

function recordCurrentWatch() {
  if (currentPlayerId == null) return;
  if (currentPlayerSeason != null && currentPlayerEpisode != null) {
    recordWatch({
      media_type: 'tv',
      id: currentPlayerId,
      name: seriesData?.name,
      poster_path: seriesData?.poster_path,
      season: currentPlayerSeason,
      episode: currentPlayerEpisode,
    });
  } else {
    const title = dom.playerMeta.textContent;
    recordWatch({
      media_type: 'movie',
      id: currentPlayerId,
      title: title === 'Loading...' ? null : title,
      poster_path: currentPlayerPoster,
    });
  }
}

async function switchPlayerSeasonTab(seasonNum) {
  if (seasonNum === activePlayerSeason) return;
  activePlayerSeason = seasonNum;
  renderSeasonTabs(seasonNum);

  if (!allSeasonEpisodes.has(seasonNum)) {
    try {
      const data = await fetchJSON(`/api/tv/${currentPlayerId}/season/${seasonNum}`);
      allSeasonEpisodes.set(seasonNum, data.episodes || []);
    } catch { return; }
  }

  renderActiveSeasonEpisodes(seasonNum, currentPlayerEpisode);
}

function switchPlayerEpisode(season, epNum) {
  const eps = allSeasonEpisodes.get(season);
  const ep = eps ? eps.find((e) => e.episode_number === epNum) : null;
  if (!ep || !seriesData) return;
  const epName = ep.name || `Episode ${epNum}`;
  currentSeasonEpisodes = eps;
  currentSeasonNum = season;
  dom.playerMeta.textContent = `${seriesData.name} — ${epName}`;

  currentPlayerId = seriesData.id;
  currentPlayerSeason = season;
  currentPlayerEpisode = epNum;
  loadCurrentSource();
  recordCurrentWatch();

  if (season !== activePlayerSeason) {
    activePlayerSeason = season;
    renderSeasonTabs(season);
  }
  renderActiveSeasonEpisodes(season, epNum);
  updateRoute({ replace: true });
}

function renderSourceButtons() {
  dom.sourceButtons.innerHTML = '';
  SOURCES.forEach((src, i) => {
    const btn = document.createElement('button');
    btn.className = 'source-btn' + (i === currentSourceIndex ? ' source-btn--active' : '');
    btn.textContent = src.name;
    btn.addEventListener('click', () => switchSource(i));
    dom.sourceButtons.appendChild(btn);
  });
}

function switchSource(index) {
  if (index === currentSourceIndex) return;
  currentSourceIndex = index;
  renderSourceButtons();
  loadCurrentSource();
}

function nextSource() {
  const isTv = currentPlayerSeason != null && currentPlayerEpisode != null;
  let next = currentSourceIndex + 1;
  while (next < SOURCES.length) {
    if (!isTv || SOURCES[next].tv) break;
    next++;
  }
  return next < SOURCES.length ? next : -1;
}

function loadCurrentSource() {
  if (currentPlayerId == null) return;
  const isTv = currentPlayerSeason != null && currentPlayerEpisode != null;
  const src = SOURCES[currentSourceIndex];
  clearTimeout(fallbackTimer);

  if (isTv && !src.tv) {
    const n = nextSource();
    if (n >= 0) {
      currentSourceIndex = n;
      renderSourceButtons();
      loadCurrentSource();
    }
    return;
  }

  if (isTv) {
    setPlayerSrc(src.tv(currentPlayerId, currentPlayerSeason, currentPlayerEpisode));
  } else {
    setPlayerSrc(src.movie(currentPlayerId));
  }

  fallbackTimer = setTimeout(() => {
    const n = nextSource();
    if (n >= 0) {
      currentSourceIndex = n;
      renderSourceButtons();
      loadCurrentSource();
    }
  }, 8000);
}

async function openPlayer(id, title, season, episode, fromRoute) {
  dom.playerMeta.textContent = title;
  setPlayerSrc(null);
  document.body.classList.add('is-streaming');
  showView(dom.playerView);

  currentPlayerId = id;
  currentPlayerSeason = season ?? null;
  currentPlayerEpisode = episode ?? null;

  renderSourceButtons();
  dom.playerNext.classList.add('hidden');
  loadCurrentSource();
  if (!fromRoute) updateRoute();
  recordCurrentWatch();
  dom.playerBack.focus();

  if (season != null && episode != null) {
    dom.playerEpisodes.classList.remove('hidden');
    allSeasonEpisodes.clear();

    availableSeasons = (seriesData && seriesData.seasons
      ? seriesData.seasons.filter((s) => s.season_number > 0)
      : []
    ).sort((a, b) => a.season_number - b.season_number);

    activePlayerSeason = Number(season);
    renderSeasonTabs(activePlayerSeason);

    // Reuse the list the TV view already loaded for this season.
    if (currentSeasonNum === activePlayerSeason && currentSeasonEpisodes.length) {
      allSeasonEpisodes.set(activePlayerSeason, currentSeasonEpisodes);
    } else {
      try {
        const data = await fetchJSON(`/api/tv/${id}/season/${activePlayerSeason}`);
        if (currentPlayerId !== id || currentPlayerSeason !== season) return;
        allSeasonEpisodes.set(activePlayerSeason, data.episodes || []);
      } catch { /* empty */ }
    }

    renderActiveSeasonEpisodes(activePlayerSeason, Number(episode));
  } else {
    dom.playerEpisodes.classList.add('hidden');
  }
}

function onPlayerLoad() {
  clearTimeout(fallbackTimer);
}

function onPlayerError() {
  clearTimeout(fallbackTimer);
  const n = nextSource();
  if (n >= 0) {
    currentSourceIndex = n;
    renderSourceButtons();
    loadCurrentSource();
  }
}

// Changing an existing iframe's src adds a browser-history entry, so Back
// would step the embed back instead of leaving the player. A freshly inserted
// iframe's first navigation adds no entry, so swap in a new element per load.
function setPlayerSrc(url) {
  const old = dom.playerIframe;
  const frame = old.cloneNode(false);
  frame.removeAttribute('src');
  if (url) frame.src = url;
  frame.addEventListener('load', onPlayerLoad);
  frame.addEventListener('error', onPlayerError);
  old.replaceWith(frame);
  dom.playerIframe = frame;
}

function closePlayer(silent) {
  document.body.classList.remove('is-streaming');
  setPlayerSrc(null);
  dom.playerEpisodes.classList.add('hidden');
  allSeasonEpisodes.clear();
  availableSeasons = [];
  activePlayerSeason = null;
  dom.seasonTabs.innerHTML = '';
  dom.playerEpisodesList.innerHTML = '';
  clearTimeout(fallbackTimer);
  currentPlayerId = null;
  currentPlayerSeason = null;
  currentPlayerEpisode = null;
  if (seriesData) {
    showView(dom.tvView);
    dom.tvBack.focus();
  } else {
    showResultsView();
  }
  if (!silent) updateRoute();
}

function closeTv(silent) {
  seriesData = null;
  currentSeasonEpisodes = [];
  currentSeasonNum = null;
  dom.seasonSelect.innerHTML = '';
  dom.episodesList.innerHTML = '';
  showResultsView();
  if (!silent) updateRoute();
}

// Returning from a deep-linked title leaves an empty grid behind; fill it.
function showResultsView() {
  showView(dom.resultsView);
  if (!lastQuery && dom.resultsGrid.childElementCount === 0) loadTrending();
  else renderContinue();
  (dom.resultsGrid.querySelector('.card') || dom.searchFab).focus();
}

// ─── EVENT BINDING ───

dom.searchFab.addEventListener('click', openSearch);

dom.searchClose.addEventListener('click', closeSearch);

dom.searchBackdrop.addEventListener('click', closeSearch);

dom.searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    doSearch(dom.searchInput.value);
  }
});

dom.searchInput.addEventListener('input', () => {
  const q = dom.searchInput.value;
  dom.searchClear.classList.toggle('hidden', !q);
});

dom.searchClear.addEventListener('click', () => {
  dom.searchInput.value = '';
  dom.searchInput.focus();
  dom.searchClear.classList.add('hidden');
  lastQuery = '';
  loadTrending();
  updateRoute();
});

dom.resultsRetry.addEventListener('click', () => {
  if (lastQuery) doSearch(lastQuery, { force: true });
  else loadTrending();
});

dom.resultsMore.addEventListener('click', loadMoreResults);
dom.playerNext.addEventListener('click', playNextEpisode);

document.addEventListener('visibilitychange', () => {
  document.body.classList.toggle('is-hidden', document.hidden);
});

dom.tvBack.addEventListener('click', () => closeTv());
dom.playerBack.addEventListener('click', () => closePlayer());

dom.seasonSelect.addEventListener('change', () => {
  const num = toInt(dom.seasonSelect.value);
  if (num && seriesData) loadEpisodes(seriesData.id, num);
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (dom.searchBar.classList.contains('is-active')) {
      closeSearch();
    } else if (dom.playerView.classList.contains('active')) {
      closePlayer();
    } else if (dom.tvView.classList.contains('active')) {
      closeTv();
    }
  }
  const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement;
  if (e.key === 'n' && !typing && !e.ctrlKey && !e.metaKey && !e.altKey && isActive(dom.playerView)) {
    playNextEpisode();
  }
  if (e.key === '/' && !dom.searchBar.classList.contains('is-active') && !dom.playerView.classList.contains('active')) {
    e.preventDefault();
    openSearch();
  }
});

// popstate covers back/forward and manually edited hashes; listening to
// hashchange as well would run handleRoute twice per navigation.
window.addEventListener('popstate', handleRoute);

// ─── INIT ───

handleRoute();
