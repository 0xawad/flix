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
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

async function fetchJSON(url) {
  const res = await fetch(url);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || data.status_message || `Request failed (${res.status})`);
  return data;
}

function updateRoute() {
  if (dom.playerView.classList.contains('active')) {
    if (seriesData && currentSeasonNum != null) {
      const ep = currentSeasonEpisodes.find((e) => e.episode_number != null && dom.playerMeta.textContent.includes(e.name || `Episode ${e.episode_number}`));
      const epNum = ep ? ep.episode_number : currentSeasonNum;
      location.hash = `#/tv/${seriesData.id}/watch/${currentSeasonNum}/${epNum}`;
    } else {
      location.hash = `#/movie/${seriesData ? seriesData.id : 'unknown'}/watch`;
    }
  } else if (dom.tvView.classList.contains('active') && seriesData) {
    if (currentSeasonNum != null) {
      location.hash = `#/tv/${seriesData.id}/season/${currentSeasonNum}`;
    } else {
      location.hash = `#/tv/${seriesData.id}`;
    }
  } else if (dom.resultsView.classList.contains('active') && lastQuery) {
    location.hash = `#/search/${encodeURIComponent(lastQuery)}`;
  } else {
    location.hash = '#/';
  }
}

function handleRoute() {
  const hash = location.hash || '#/';
  const parts = hash.slice(2).split('/');

  if (parts[0] === 'search' && parts[1]) {
    const query = decodeURIComponent(parts.slice(1).join('/'));
    if (query && query !== lastQuery) {
      dom.searchInput.value = query;
      doSearch(query, true);
    }
  } else if (parts[0] === 'tv' && parts[1]) {
    const id = Number(parts[1]);
    if (!id) return;
    if (parts[2] === 'watch' && parts[3] && parts[4]) {
      const season = Number(parts[3]);
      const episode = Number(parts[4]);
      if (seriesData && seriesData.id === id && currentSeasonNum === season) {
        openPlayer(id, dom.playerMeta.textContent, season, episode, true);
      } else {
        openTvAndWatch(id, season, episode);
      }
    } else if (parts[2] === 'season' && parts[3]) {
      const season = Number(parts[3]);
      if (seriesData && seriesData.id === id) {
        if (currentSeasonNum !== season) {
          dom.seasonSelect.value = season;
          loadEpisodes(id, season);
        }
      } else {
        openTvAndSeason(id, season);
      }
    } else {
      if (!seriesData || seriesData.id !== id) {
        openTv(id, 'Loading...', true);
      }
    }
  } else if (parts[0] === 'movie' && parts[1] && parts[2] === 'watch') {
    const id = Number(parts[1]);
    if (!id) return;
    if (dom.playerView.classList.contains('active') && seriesData && seriesData.id === id) return;
    openPlayer(id, dom.playerMeta.textContent || 'Loading...', undefined, undefined, true);
  } else {
    if (dom.resultsView.classList.contains('active') && !lastQuery) return;
    if (dom.tvView.classList.contains('active') || dom.playerView.classList.contains('active')) {
      closeTv(true);
      closePlayer(true);
    }
    if (!lastQuery) loadTrending();
  }
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

async function doSearch(query, fromRoute) {
  query = query.trim();
  if (!query || query === lastQuery) return;
  closeSearch();
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
    dom.resultsLoading.classList.add('hidden');
    renderResults(data);
  } catch (err) {
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
  if (!lastQuery) updateRoute();

  try {
    const data = await fetchJSON('/api/trending');
    dom.resultsLoading.classList.add('hidden');
    renderResults(data);
  } catch (err) {
    dom.resultsLoading.classList.add('hidden');
    renderResults({ results: [] });
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
    openTv(item.id, title);
  }
}

async function openTv(id, title, fromRoute) {
  dom.tvLoading.classList.remove('hidden');
  dom.episodesList.innerHTML = '';
  dom.seasonSelect.innerHTML = '<option value="">Loading...</option>';
  showView(dom.tvView);

  try {
    const data = await fetchJSON(`/api/tv/${id}`);
    seriesData = data;

    renderPoster(dom.tvPoster, data.poster_path, title);
    dom.tvTitle.textContent = title;
    dom.tvOverview.textContent = data.overview || '';

    dom.seasonSelect.innerHTML = '';
    const seasons = (data.seasons || []).filter((s) => s.season_number > 0);

    if (seasons.length === 0) {
      dom.tvLoading.classList.add('hidden');
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

    dom.tvLoading.classList.add('hidden');

    dom.seasonSelect.value = seasons[0].season_number;
    loadEpisodes(id, seasons[0].season_number);
    if (!fromRoute) updateRoute();
    dom.tvBack.focus();
  } catch (err) {
    dom.tvLoading.classList.add('hidden');
    dom.episodesList.innerHTML = `
      <div class="state state--full">
        <p>${escape(err.message)}</p>
      </div>`;
  }
}

async function openTvAndSeason(id, season) {
  dom.tvLoading.classList.remove('hidden');
  dom.episodesList.innerHTML = '';
  dom.seasonSelect.innerHTML = '<option value="">Loading...</option>';
  showView(dom.tvView);

  try {
    const data = await fetchJSON(`/api/tv/${id}`);
    seriesData = data;

    dom.tvTitle.textContent = data.name || 'Untitled';
    dom.tvOverview.textContent = data.overview || '';

    const seasons = (data.seasons || []).filter((s) => s.season_number > 0);
    dom.seasonSelect.innerHTML = '';
    seasons.forEach((s) => {
      const opt = document.createElement('option');
      opt.value = s.season_number;
      opt.textContent = `${s.name} (${s.episode_count} eps)`;
      dom.seasonSelect.appendChild(opt);
    });

    renderPoster(dom.tvPoster, data.poster_path, data.name || 'Untitled');

    dom.tvLoading.classList.add('hidden');

    const targetSeason = seasons.find((s) => s.season_number === season) ? season : seasons[0]?.season_number;
    if (targetSeason != null) {
      dom.seasonSelect.value = targetSeason;
      loadEpisodes(id, targetSeason);
    }
    dom.tvBack.focus();
  } catch (err) {
    dom.tvLoading.classList.add('hidden');
    dom.episodesList.innerHTML = `
      <div class="state state--full">
        <p>${escape(err.message)}</p>
      </div>`;
  }
}

async function openTvAndWatch(id, season, episode) {
  dom.tvLoading.classList.remove('hidden');
  dom.episodesList.innerHTML = '';
  dom.seasonSelect.innerHTML = '<option value="">Loading...</option>';
  showView(dom.tvView);

  try {
    const data = await fetchJSON(`/api/tv/${id}`);
    seriesData = data;

    dom.tvTitle.textContent = data.name || 'Untitled';
    dom.tvOverview.textContent = data.overview || '';

    const seasons = (data.seasons || []).filter((s) => s.season_number > 0);
    dom.seasonSelect.innerHTML = '';
    seasons.forEach((s) => {
      const opt = document.createElement('option');
      opt.value = s.season_number;
      opt.textContent = `${s.name} (${s.episode_count} eps)`;
      dom.seasonSelect.appendChild(opt);
    });

    renderPoster(dom.tvPoster, data.poster_path, data.name || 'Untitled');

    dom.tvLoading.classList.add('hidden');

    const targetSeason = seasons.find((s) => s.season_number === season) ? season : seasons[0]?.season_number;
    if (targetSeason != null) {
      dom.seasonSelect.value = targetSeason;
      await loadEpisodes(id, targetSeason);
    }

    const epName = currentSeasonEpisodes.find((e) => e.episode_number === episode)?.name || `Episode ${episode}`;
    openPlayer(id, `${data.name} — ${epName}`, season, episode, true);
  } catch (err) {
    dom.tvLoading.classList.add('hidden');
    dom.episodesList.innerHTML = `
      <div class="state state--full">
        <p>${escape(err.message)}</p>
      </div>`;
  }
}

async function loadEpisodes(seriesId, seasonNum) {
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
  updateRoute();
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
    dom.playerIframe.src = src.tv(currentPlayerId, currentPlayerSeason, currentPlayerEpisode);
  } else {
    dom.playerIframe.src = src.movie(currentPlayerId);
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
  dom.playerIframe.src = '';
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

dom.playerIframe.addEventListener('load', () => {
  clearTimeout(fallbackTimer);
});

dom.playerIframe.addEventListener('error', () => {
  clearTimeout(fallbackTimer);
  const n = nextSource();
  if (n >= 0) {
    currentSourceIndex = n;
    renderSourceButtons();
    loadCurrentSource();
  }
});

function closePlayer(silent) {
  document.body.classList.remove('is-streaming');
  dom.playerIframe.src = '';
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
    showView(dom.resultsView);
    dom.resultsGrid.focus();
  }
  if (!silent) updateRoute();
}

function closeTv(silent) {
  seriesData = null;
  currentSeasonEpisodes = [];
  currentSeasonNum = null;
  dom.seasonSelect.innerHTML = '';
  dom.episodesList.innerHTML = '';
  showView(dom.resultsView);
  if (!silent) updateRoute();
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
});

dom.resultsRetry.addEventListener('click', () => {
  if (lastQuery) doSearch(lastQuery);
});

dom.tvBack.addEventListener('click', closeTv);
dom.playerBack.addEventListener('click', closePlayer);

dom.seasonSelect.addEventListener('change', () => {
  const num = dom.seasonSelect.value;
  if (num && seriesData) {
    loadEpisodes(seriesData.id, num);
    updateRoute();
  }
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

window.addEventListener('hashchange', handleRoute);

// ─── INIT ───

if (location.hash && location.hash !== '#/') {
  handleRoute();
} else {
  loadTrending();
}
