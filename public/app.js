'use strict';

// ── DOM refs ────────────────────────────────────────────────
const newsList   = document.getElementById('news-list');
const loading    = document.getElementById('loading');
const errorEl    = document.getElementById('error');
const statusBar  = document.getElementById('status-bar');
const refreshBtn = document.getElementById('refreshBtn');

// ── Helpers ─────────────────────────────────────────────────

function timeAgo(ts) {
  const diff = Math.max(0, Date.now() - ts);
  const mins  = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days  = Math.floor(diff / 86400000);
  if (days > 0)  return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (mins > 0)  return `${mins}m ago`;
  return 'just now';
}

function formatTime(ts) {
  return new Date(ts).toLocaleString(undefined, {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function badgeClass(sourceType) {
  switch (sourceType) {
    case 'reddit': return 'badge-reddit';
    case 'apple':  return 'badge-apple';
    case 'hn':     return 'badge-hn';
    default:       return 'badge-blog';
  }
}

function escapeHTML(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Render ───────────────────────────────────────────────────

function renderItems(items) {
  newsList.innerHTML = '';

  if (!items || items.length === 0) {
    newsList.innerHTML = '<li style="padding:20px;color:#828282">No items found.</li>';
    return;
  }

  const fragment = document.createDocumentFragment();

  items.forEach((item) => {
    const li = document.createElement('li');
    li.className = 'news-item';

    // Build meta parts
    const metaParts = [];
    if (item.score !== null && item.score !== undefined) {
      metaParts.push(`<span>${item.score} pts</span><span class="dot">·</span>`);
    }
    if (item.author) {
      metaParts.push(`<span>by ${escapeHTML(item.author)}</span><span class="dot">·</span>`);
    }
    metaParts.push(`<span title="${escapeHTML(formatTime(item.timestamp))}">${escapeHTML(timeAgo(item.timestamp))}</span>`);
    if (item.numComments !== null && item.numComments !== undefined) {
      const commUrl = item.commentsUrl || item.url;
      metaParts.push(
        `<span class="dot">·</span><a href="${escapeHTML(commUrl)}" target="_blank" rel="noopener noreferrer">${item.numComments} comments</a>`
      );
    }

    li.innerHTML = `
      <span class="rank"></span>
      <div class="item-body">
        <div class="item-title-row">
          <a class="item-title"
             href="${escapeHTML(item.url)}"
             target="_blank"
             rel="noopener noreferrer">${escapeHTML(item.title)}</a>
          <span class="source-badge ${badgeClass(item.sourceType)}">${escapeHTML(item.source)}</span>
        </div>
        <div class="item-meta">${metaParts.join('')}</div>
      </div>`;

    fragment.appendChild(li);
  });

  newsList.appendChild(fragment);
}

function renderStatus(fetchedAt, cached, count) {
  const time = formatTime(fetchedAt);
  const cacheNote = cached ? ' (cached)' : '';
  statusBar.textContent = `${count} stories · updated ${time}${cacheNote}`;
}

// ── Fetch ────────────────────────────────────────────────────

async function loadNews(forceRefresh = false) {
  loading.hidden = false;
  errorEl.hidden = true;
  newsList.innerHTML = '';
  statusBar.textContent = '';
  refreshBtn.textContent = 'loading…';
  refreshBtn.style.pointerEvents = 'none';

  const endpoint = forceRefresh ? '/api/refresh' : '/api/news';

  try {
    const res = await fetch(endpoint);
    if (!res.ok) throw new Error(`Server responded with ${res.status}`);
    const { items, fetchedAt, cached } = await res.json();
    renderItems(items);
    renderStatus(fetchedAt, cached, items.length);
  } catch (err) {
    errorEl.textContent = `Could not load news: ${err.message}. Is the server running?`;
    errorEl.hidden = false;
  } finally {
    loading.hidden = true;
    refreshBtn.textContent = 'refresh';
    refreshBtn.style.pointerEvents = '';
  }
}

// ── Init ─────────────────────────────────────────────────────

refreshBtn.addEventListener('click', (e) => {
  e.preventDefault();
  loadNews(true);
});

loadNews();
