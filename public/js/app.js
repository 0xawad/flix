const IMG_BASE = 'https://image.tmdb.org/t/p/w342';
const VIDCORE_BASE = 'https://vidcore.net/movie';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const searchForm = $('#search-form');
const searchInput = $('#search-input');
const searchClear = $('#search-clear');
const resultsGrid = $('#results-grid');
const emptyState = $('#empty-state');
const loadingState = $('#loading-state');
const errorState = $('#error-state');
const errorMessage = $('#error-message');
const retryBtn = $('#retry-btn');
const resultsSection = $('#results-section');
const tvSection = $('#tv-section');
const tvBack = $('#tv-back');
const tvPoster = $('#tv-poster');
const tvTitle = $('#tv-title');
const tvOverview = $('#tv-overview');
const seasonSelect = $('#season-select');
const episodesGrid = $('#episodes-grid');
const tvLoading = $('#tv-loading');
const playerSection = $('#player-section');
const playerBack = $('#player-back');
const playerTitle = $('#player-title');
const playerIframe = $('#player-iframe');

let searchTimer = null;
let lastQuery = '';
let currentSeriesData = null;
let currentEpisodeData = null;

function showSection(section) {
  [resultsSection, tvSection, playerSection].forEach((s) => {
    s.classList.remove('visible');
    s.classList.add('hidden');
  });
  section.classList.remove('hidden');
  requestAnimationFrame(() => section.classList.add('visible'));
}

function showStates(states) {
  [emptyState, loadingState, errorState].forEach((s) => s.classList.add('hidden'));
  states.forEach((s) => s.classList.remove('hidden'));
}

function posterUrl(path) {
  return path ? `${IMG_BASE}${path}` : null;
}

function renderPoster(container, path, alt) {
  const url = posterUrl(path);
  if (url) {
    container.innerHTML = `<img src="${url}" alt="${alt}" loading="lazy">`;
  } else {
    container.innerHTML = `<div class="no-poster">No poster</div>`;
  }
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return isNaN(d.getTime()) ? dateStr : d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function mediaTypeLabel(type) {
  return type === 'movie' ? 'Movie' : 'TV';
}

function mediaTypeBadge(type) {
  const cls = type === 'movie' ? 'badge-movie' : 'badge-tv';
  return `<span class="result-badge ${cls}">${mediaTypeLabel(type)}</span>`;
}

function buildVidCoreUrl(id) {
  return `${VIDCORE_BASE}/${id}`;
}

function playMedia(id, title) {
  playerTitle.textContent = title;
  playerIframe.src = buildVidCoreUrl(id);
  showSection(playerSection);
}

function goBackFromPlayer() {
  playerIframe.src = '';
  if (currentSeriesData) {
    showSection(tvSection);
  } else {
    showSection(resultsSection);
  }
}

function goBackFromTv() {
  currentSeriesData = null;
  seasonSelect.innerHTML = '';
  episodesGrid.innerHTML = '';
  showSection(resultsSection);
}

async function fetchSearch(query) {
  const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
  if (!res.ok) throw new Error('Search request failed');
  return res.json();
}

async function fetchTvDetails(id) {
  const res = await fetch(`/api/tv/${id}`);
  if (!res.ok) throw new Error('Failed to fetch series details');
  return res.json();
}

async function fetchSeasonEpisodes(id, num) {
  const res = await fetch(`/api/tv/${id}/season/${num}`);
  if (!res.ok) throw new Error('Failed to fetch episodes');
  return res.json();
}

function renderResults(data) {
  resultsGrid.innerHTML = '';

  const results = (data.results || []).filter(
    (r) => r.media_type === 'movie' || r.media_type === 'tv'
  );

  if (results.length === 0) {
    showStates([emptyState]);
    emptyState.querySelector('p').textContent = `No results for "${lastQuery}"`;
    return;
  }

  showStates([]);

  results.forEach((item) => {
    const card = document.createElement('div');
    card.className = 'result-card';
    card.tabIndex = 0;
    card.setAttribute('role', 'button');

    const title = item.title || item.name || 'Untitled';
    const year = (item.release_date || item.first_air_date || '').slice(0, 4);
    const imgUrl = posterUrl(item.poster_path);
    const mediaType = item.media_type;

    const posterHtml = imgUrl
      ? `<img src="${imgUrl}" alt="${title}" loading="lazy">`
      : `<div class="no-poster">No poster</div>`;

    card.innerHTML = `
      <div class="result-poster">${posterHtml}</div>
      <div class="result-info">
        <div class="result-title">${escapeHtml(title)}</div>
        <div class="result-year">${year}</div>
        ${mediaTypeBadge(mediaType)}
      </div>
    `;

    card.addEventListener('click', () => handleResultClick(item));
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        handleResultClick(item);
      }
    });

    resultsGrid.appendChild(card);
  });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

async function handleResultClick(item) {
  const title = item.title || item.name || 'Untitled';

  if (item.media_type === 'movie') {
    playMedia(item.id, title);
  } else {
    await openTvDetail(item.id, title);
  }
}

async function openTvDetail(id, title) {
  tvLoading.classList.remove('hidden');
  episodesGrid.innerHTML = '';
  seasonSelect.innerHTML = '';
  showSection(tvSection);

  try {
    const data = await fetchTvDetails(id);
    currentSeriesData = data;

    renderPoster(tvPoster, data.poster_path, title);
    tvTitle.textContent = title;
    tvOverview.textContent = data.overview || 'No overview available.';

    seasonSelect.innerHTML = '<option value="">Select a season</option>';
    (data.seasons || [])
      .filter((s) => s.season_number > 0)
      .forEach((s) => {
        const opt = document.createElement('option');
        opt.value = s.season_number;
        opt.textContent = `${s.name} (${s.episode_count} episodes)`;
        seasonSelect.appendChild(opt);
      });

    tvLoading.classList.add('hidden');

    if (seasonSelect.options.length > 1) {
      seasonSelect.value = seasonSelect.options[1].value;
      seasonSelect.dispatchEvent(new Event('change'));
    }
  } catch (err) {
    tvLoading.classList.add('hidden');
    showStates([errorState]);
    errorMessage.textContent = err.message || 'Failed to load series details';
  }
}

async function loadEpisodes(seriesId, seasonNum) {
  episodesGrid.innerHTML = '';
  episodesGrid.classList.add('hidden');

  const loading = document.createElement('div');
  loading.className = 'state-message';
  loading.innerHTML = '<div class="spinner"></div><p>Loading episodes...</p>';
  episodesGrid.parentNode.insertBefore(loading, episodesGrid);

  try {
    const data = await fetchSeasonEpisodes(seriesId, seasonNum);
    loading.remove();
    episodesGrid.classList.remove('hidden');

    const episodes = data.episodes || [];
    if (episodes.length === 0) {
      episodesGrid.innerHTML = `
        <div class="state-message">
          <p>No episodes found for this season.</p>
        </div>`;
      return;
    }

    episodesGrid.innerHTML = '';
    episodes.forEach((ep) => {
      const card = document.createElement('div');
      card.className = 'episode-card';
      card.tabIndex = 0;
      card.setAttribute('role', 'button');

      card.innerHTML = `
        <div class="episode-number">E${ep.episode_number}</div>
        <div class="episode-name">${escapeHtml(ep.name || `Episode ${ep.episode_number}`)}</div>
        <div class="episode-air">${formatDate(ep.air_date)}</div>
      `;

      card.addEventListener('click', () => {
        playMedia(ep.id, `${currentSeriesData.name} - ${ep.name || `Episode ${ep.episode_number}`}`);
      });
      card.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          card.click();
        }
      });

      episodesGrid.appendChild(card);
    });
  } catch (err) {
    loading.remove();
    episodesGrid.classList.remove('hidden');
    episodesGrid.innerHTML = `
      <div class="state-message">
        <p>Failed to load episodes. ${escapeHtml(err.message || '')}</p>
      </div>`;
  }
}

async function doSearch(query) {
  query = query.trim();
  if (!query || query === lastQuery) return;

  lastQuery = query;
  searchClear.classList.toggle('hidden', !query);

  showSection(resultsSection);
  episodesGrid.innerHTML = '';
  currentSeriesData = null;
  showStates([loadingState]);

  try {
    const data = await fetchSearch(query);
    renderResults(data);
  } catch (err) {
    showStates([errorState]);
    errorMessage.textContent = err.message || 'Search failed. Please try again.';
  }
}

function onSearchInput() {
  const query = searchInput.value;
  searchClear.classList.toggle('hidden', !query);

  clearTimeout(searchTimer);
  if (query.trim().length === 0) {
    lastQuery = '';
    resultsGrid.innerHTML = '';
    showStates([emptyState]);
    emptyState.querySelector('p').textContent = 'Search for a movie or TV series to start';
    return;
  }

  searchTimer = setTimeout(() => doSearch(query), 300);
}

searchForm.addEventListener('submit', (e) => {
  e.preventDefault();
  clearTimeout(searchTimer);
  doSearch(searchInput.value);
});

searchInput.addEventListener('input', onSearchInput);

searchClear.addEventListener('click', () => {
  searchInput.value = '';
  searchInput.focus();
  onSearchInput();
});

retryBtn.addEventListener('click', () => {
  if (lastQuery) doSearch(lastQuery);
});

tvBack.addEventListener('click', goBackFromTv);

playerBack.addEventListener('click', goBackFromPlayer);

seasonSelect.addEventListener('change', () => {
  const seasonNum = seasonSelect.value;
  if (seasonNum && currentSeriesData) {
    loadEpisodes(currentSeriesData.id, seasonNum);
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (!playerSection.classList.contains('hidden')) {
      goBackFromPlayer();
    } else if (!tvSection.classList.contains('hidden')) {
      goBackFromTv();
    }
  }
});

showStates([emptyState]);
resultsSection.classList.remove('hidden');
resultsSection.classList.add('visible');
