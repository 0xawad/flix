const IMG_BASE = 'https://image.tmdb.org/t/p/w500';
const VIDCORE_BASE = 'https://vidcore.net/movie';
const VIDCORE_TV = 'https://vidcore.net/tv';

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
};

let lastQuery = '';
let seriesData = null;
let currentSeasonEpisodes = [];
let currentSeasonNum = null;
let seasonLoadGeneration = 0;
let allSeasonEpisodes = new Map();

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
        <div class="state" style="grid-column:1/-1">
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
      <div class="state" style="grid-column:1/-1">
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
      <div class="state" style="grid-column:1/-1">
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
      <div class="state" style="grid-column:1/-1">
        <p>${escape(err.message)}</p>
      </div>`;
  }
}

async function loadEpisodes(seriesId, seasonNum) {
  const gen = ++seasonLoadGeneration;
  currentSeasonEpisodes = [];
  currentSeasonNum = null;
  dom.episodesList.innerHTML = `
    <div class="state" style="grid-column:1/-1">
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
        <div class="state" style="grid-column:1/-1">
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
      <div class="state" style="grid-column:1/-1">
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

function renderPlayerSeasonGroup(seasonNum, episodes, activeSeason, activeEpNum) {
  const divider = document.createElement('div');
  divider.className = 'season-divider';
  divider.textContent = `Season ${seasonNum}`;
  if (seasonNum === activeSeason) divider.classList.add('season-divider--active');
  dom.playerEpisodesList.appendChild(divider);

  episodes.forEach((ep) => {
    const isActive = seasonNum === activeSeason && ep.episode_number === activeEpNum;
    dom.playerEpisodesList.appendChild(renderPlayerEpisodeCard(ep, isActive, seasonNum));
  });
}

function renderAllPlayerEpisodes(activeSeason, activeEpNum) {
  dom.playerEpisodesList.innerHTML = '';
  const sorted = [...allSeasonEpisodes.keys()].sort((a, b) => a - b);
  sorted.forEach((seasonNum) => {
    renderPlayerSeasonGroup(seasonNum, allSeasonEpisodes.get(seasonNum), activeSeason, activeEpNum);
  });
}

function highlightPlayerEpisode(activeSeason, activeEpNum) {
  dom.playerEpisodesList.querySelectorAll('.episode--active').forEach((el) => el.classList.remove('episode--active'));
  dom.playerEpisodesList.querySelectorAll('.season-divider--active').forEach((el) => el.classList.remove('season-divider--active'));

  const dividers = dom.playerEpisodesList.querySelectorAll('.season-divider');
  dividers.forEach((d) => {
    const num = Number(d.textContent.replace('Season ', ''));
    if (num === activeSeason) d.classList.add('season-divider--active');
  });

  const cards = dom.playerEpisodesList.querySelectorAll('.episode');
  let idx = 0;
  const sorted = [...allSeasonEpisodes.keys()].sort((a, b) => a - b);
  for (const sn of sorted) {
    const eps = allSeasonEpisodes.get(sn);
    for (const ep of eps) {
      if (sn === activeSeason && ep.episode_number === activeEpNum && cards[idx]) {
        cards[idx].classList.add('episode--active');
        cards[idx].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        return;
      }
      idx++;
    }
  }
}

async function fetchAndAppendSeason(seriesId, seasonNum, activeSeason, activeEpNum) {
  if (allSeasonEpisodes.has(seasonNum)) return;
  try {
    const data = await fetchJSON(`/api/tv/${seriesId}/season/${seasonNum}`);
    const episodes = data.episodes || [];
    allSeasonEpisodes.set(seasonNum, episodes);
    renderPlayerSeasonGroup(seasonNum, episodes, activeSeason, activeEpNum);
  } catch {
    // skip failed seasons silently
  }
}

function switchPlayerEpisode(season, epNum) {
  const eps = allSeasonEpisodes.get(season);
  const ep = eps ? eps.find((e) => e.episode_number === epNum) : null;
  if (!ep || !seriesData) return;
  const epName = ep.name || `Episode ${epNum}`;
  currentSeasonEpisodes = eps;
  currentSeasonNum = season;
  dom.playerMeta.textContent = `${seriesData.name} — ${epName}`;
  dom.playerIframe.src = `${VIDCORE_TV}/${seriesData.id}/${season}/${epNum}`;
  highlightPlayerEpisode(season, epNum);
  updateRoute();
}

async function openPlayer(id, title, season, episode, fromRoute) {
  dom.playerMeta.textContent = title;
  dom.playerIframe.src = '';
  document.body.classList.add('is-streaming');
  showView(dom.playerView);
  if (season != null && episode != null) {
    dom.playerIframe.src = `${VIDCORE_TV}/${id}/${season}/${episode}`;
    dom.playerEpisodes.classList.remove('hidden');
    allSeasonEpisodes.set(Number(season), currentSeasonEpisodes);
    renderAllPlayerEpisodes(Number(season), Number(episode));
    if (seriesData && seriesData.seasons) {
      const otherSeasons = seriesData.seasons
        .filter((s) => s.season_number > 0 && s.season_number !== Number(season))
        .sort((a, b) => a.season_number - b.season_number);
      for (const s of otherSeasons) {
        await fetchAndAppendSeason(id, s.season_number, Number(season), Number(episode));
      }
    }
  } else {
    dom.playerIframe.src = `${VIDCORE_BASE}/${id}`;
    dom.playerEpisodes.classList.add('hidden');
  }
  if (!fromRoute) updateRoute();
  dom.playerBack.focus();
}

dom.playerIframe.addEventListener('error', () => {
  dom.playerIframe.style.display = 'none';
});

function closePlayer(silent) {
  document.body.classList.remove('is-streaming');
  dom.playerIframe.src = '';
  dom.playerEpisodes.classList.add('hidden');
  allSeasonEpisodes.clear();
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
