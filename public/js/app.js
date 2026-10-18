const IMG_BASE = 'https://image.tmdb.org/t/p/w500';

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

function showView(view) {
  $$('.view').forEach((v) => v.classList.remove('active'));
  view.classList.remove('hidden');
  view.classList.add('active');
}

function posterUrl(path) {
  return path ? `${IMG_BASE}${path}` : null;
}

function renderPoster(el, path, alt) {
  const url = posterUrl(path);
  el.innerHTML = url
    ? `<img src="${url}" alt="${escape(alt)}" loading="lazy">`
    : `<div class="no-poster">No poster</div>`;
}

function escape(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function fetchJSON(url) {
  const res = await fetch(url);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || data.status_message || `Request failed (${res.status})`);
  return data;
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
    openPlayer(id, 'Loading...', undefined, undefined, true);
    fetchJSON(`/api/movie/${id}`)
      .then((data) => {
        if (currentPlayerId === id && currentPlayerSeason == null) {
          dom.playerMeta.textContent = data.title || 'Untitled';
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
  dom.resultsEmpty.classList.add('hidden');
  dom.resultsError.classList.add('hidden');
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

function renderResults(data) {
  const items = (data.results || []).filter(
    (r) => r.media_type === 'movie' || r.media_type === 'tv'
  );

  if (items.length === 0) {
    dom.resultsEmpty.classList.remove('hidden');
    dom.resultsCount.textContent = '0';
    return;
  }

  dom.resultsCount.textContent = `${items.length}`;

  items.forEach((item) => {
    const card = document.createElement('div');
    card.className = 'card';
    card.tabIndex = 0;
    card.setAttribute('role', 'button');

    const title = item.title || item.name || 'Untitled';
    const year = (item.release_date || item.first_air_date || '').slice(0, 4);
    const imgUrl = posterUrl(item.poster_path);
    const isMovie = item.media_type === 'movie';

    card.setAttribute('aria-label', `Play ${title}${year ? ` (${year})` : ''}`);

    const playIcon = '<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3" fill="currentColor"/></svg>';

    card.innerHTML = `
      <div class="card-poster">
        ${imgUrl ? `<img src="${imgUrl}" alt="${escape(title)}" loading="lazy">` : `<div class="no-poster">No poster</div>`}
        <div class="card-overlay">
          <div class="card-play">${playIcon}</div>
          <div class="card-info">
            <div class="card-title">${escape(title)}</div>
            <div class="card-meta">${year}${year ? ' · ' : ''}<span class="card-tag ${isMovie ? 'card-tag--movie' : 'card-tag--tv'}">${isMovie ? 'Movie' : 'TV'}</span></div>
          </div>
        </div>
      </div>
    `;

    card.addEventListener('click', () => handleSelect(item));
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        handleSelect(item);
      }
    });

    dom.resultsGrid.appendChild(card);
  });
}

function handleSelect(item) {
  const title = item.title || item.name || 'Untitled';
  if (item.media_type === 'movie') {
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

  if (season != null && episode != null) {
    dom.playerEpisodes.classList.remove('hidden');
    allSeasonEpisodes.clear();

    availableSeasons = (seriesData && seriesData.seasons
      ? seriesData.seasons.filter((s) => s.season_number > 0)
      : []
    ).sort((a, b) => a.season_number - b.season_number);

    activePlayerSeason = Number(season);
    renderSeasonTabs(activePlayerSeason);

    if (!allSeasonEpisodes.has(activePlayerSeason)) {
      try {
        const data = await fetchJSON(`/api/tv/${id}/season/${activePlayerSeason}`);
        allSeasonEpisodes.set(activePlayerSeason, data.episodes || []);
      } catch { /* empty */ }
    }

    renderActiveSeasonEpisodes(activePlayerSeason, Number(episode));
  } else {
    dom.playerEpisodes.classList.add('hidden');
  }

  loadCurrentSource();
  if (!fromRoute) updateRoute();
  dom.playerBack.focus();
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
