const IMG_BASE = 'https://image.tmdb.org/t/p/w500';
const VIDCORE_BASE = 'https://vidcore.net/movie';
const VIDCORE_TV = 'https://vidcore.net/tv';

const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

const dom = {
  searchForm: $('#search-form'),
  searchInput: $('#search-input'),
  searchClear: $('#search-clear'),
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
};

let lastQuery = '';
let seriesData = null;

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
    ? `<img src="${url}" alt="${alt}" loading="lazy">`
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

async function doSearch(query) {
  query = query.trim();
  if (!query || query === lastQuery) return;
  lastQuery = query;
  seriesData = null;
  dom.searchClear.classList.remove('hidden');

  dom.resultsLoading.classList.remove('hidden');
  dom.resultsGrid.innerHTML = '';
  dom.resultsEmpty.classList.add('hidden');
  dom.resultsError.classList.add('hidden');
  dom.resultsLabel.textContent = `Results for "${query}"`;
  dom.resultsCount.textContent = '';
  showView(dom.resultsView);

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

    const posterHtml = imgUrl
      ? `<img src="${imgUrl}" alt="${escape(title)}" loading="lazy">`
      : `<div class="no-poster">No poster</div>`;

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

async function openTv(id, title) {
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
    seasons.forEach((s) => {
      const opt = document.createElement('option');
      opt.value = s.season_number;
      opt.textContent = `${s.name} (${s.episode_count} eps)`;
      dom.seasonSelect.appendChild(opt);
    });

    dom.tvLoading.classList.add('hidden');

    if (seasons.length > 0) {
      dom.seasonSelect.value = seasons[0].season_number;
      loadEpisodes(id, seasons[0].season_number);
    }
  } catch (err) {
    dom.tvLoading.classList.add('hidden');
    dom.episodesList.innerHTML = `
      <div class="state" style="grid-column:1/-1">
        <p>${escape(err.message)}</p>
      </div>`;
  }
}

async function loadEpisodes(seriesId, seasonNum) {
  dom.episodesList.innerHTML = `
    <div class="state" style="grid-column:1/-1">
      <div class="spinner"></div>
    </div>`;

  try {
    const data = await fetchJSON(`/api/tv/${seriesId}/season/${seasonNum}`);
    const episodes = data.episodes || [];

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
    dom.episodesList.innerHTML = `
      <div class="state" style="grid-column:1/-1">
        <p>${escape(err.message)}</p>
      </div>`;
  }
}

function openPlayer(id, title, season, episode) {
  dom.playerMeta.textContent = title;
  dom.playerIframe.src = '';
  document.body.classList.add('is-streaming');
  showView(dom.playerView);
  if (season != null && episode != null) {
    dom.playerIframe.src = `${VIDCORE_TV}/${id}/${season}/${episode}`;
  } else {
    dom.playerIframe.src = `${VIDCORE_BASE}/${id}`;
  }
}

dom.playerIframe.addEventListener('error', () => {
  dom.playerIframe.style.display = 'none';
});

function closePlayer() {
  document.body.classList.remove('is-streaming');
  dom.playerIframe.src = '';
  if (seriesData) {
    showView(dom.tvView);
  } else {
    showView(dom.resultsView);
  }
}

function closeTv() {
  seriesData = null;
  dom.seasonSelect.innerHTML = '';
  dom.episodesList.innerHTML = '';
  showView(dom.resultsView);
}

// ─── EVENT BINDING ───

dom.searchForm.addEventListener('submit', (e) => {
  e.preventDefault();
  doSearch(dom.searchInput.value);
});

dom.searchInput.addEventListener('input', () => {
  const q = dom.searchInput.value;
  dom.searchClear.classList.toggle('hidden', !q);
  if (!q.trim()) {
    lastQuery = '';
    loadTrending();
  }
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
  if (num && seriesData) loadEpisodes(seriesData.id, num);
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (dom.playerView.classList.contains('active')) closePlayer();
    else if (dom.tvView.classList.contains('active')) closeTv();
  }
});

loadTrending();
