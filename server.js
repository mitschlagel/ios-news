'use strict';

const express = require('express');
const fetch = require('node-fetch');
const RSSParser = require('rss-parser');

const app = express();
const rss = new RSSParser({ timeout: 10000 });
const PORT = process.env.PORT || 3000;

// ─── Source definitions ────────────────────────────────────────────────────────

const REDDIT_SUBS = [
  { sub: 'iOSProgramming', label: 'r/iOSProgramming' },
  { sub: 'swift',          label: 'r/swift'           },
  { sub: 'SwiftUI',        label: 'r/SwiftUI'         },
  { sub: 'xcode',          label: 'r/xcode'           },
];

const RSS_FEEDS = [
  { url: 'https://developer.apple.com/news/rss/news.rss',       label: 'Apple Dev News',       type: 'apple' },
  { url: 'https://www.swift.org/atom.xml',                       label: 'Swift.org',            type: 'apple' },
  { url: 'https://www.hackingwithswift.com/articles/rss',        label: 'Hacking with Swift',   type: 'blog'  },
  { url: 'https://www.swiftbysundell.com/rss',                   label: 'Swift by Sundell',     type: 'blog'  },
  { url: 'https://nshipster.com/feed.xml',                       label: 'NSHipster',            type: 'blog'  },
  { url: 'https://www.donnywals.com/feed/',                      label: 'Donny Wals',           type: 'blog'  },
  { url: 'https://iosdevweekly.com/issues.rss',                  label: 'iOS Dev Weekly',       type: 'blog'  },
];

// ─── Fetchers ──────────────────────────────────────────────────────────────────

async function fetchReddit(sub, label) {
  const url = `https://www.reddit.com/r/${sub}/new.json?limit=25&raw_json=1`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  });
  if (!res.ok) throw new Error(`Reddit ${sub}: HTTP ${res.status}`);
  const json = await res.json();
  return (json.data?.children || []).map(({ data: p }) => ({
    id: `reddit-${p.id}`,
    title: p.title,
    url: p.url.startsWith('/r/') ? `https://www.reddit.com${p.url}` : p.url,
    commentsUrl: `https://www.reddit.com${p.permalink}`,
    source: label,
    sourceType: 'reddit',
    score: p.score,
    numComments: p.num_comments,
    author: p.author,
    timestamp: p.created_utc * 1000,
  }));
}

async function fetchRSS(feedUrl, label, type) {
  const feed = await rss.parseURL(feedUrl);
  return (feed.items || []).map((item, i) => {
    const ts = item.pubDate ? new Date(item.pubDate).getTime() : Date.now() - i * 60000;
    return {
      id: `rss-${Buffer.from(item.link || item.guid || item.title || String(i)).toString('base64').slice(0, 20)}`,
      title: item.title || '(no title)',
      url: item.link || feedUrl,
      commentsUrl: null,
      source: label,
      sourceType: type,
      score: null,
      numComments: null,
      author: item.creator || item.author || null,
      timestamp: isNaN(ts) ? Date.now() : ts,
    };
  });
}

async function fetchHN() {
  // Algolia HN search — returns recent stories matching Swift/iOS/SwiftUI dev topics
  const url =
    'https://hn.algolia.com/api/v1/search?query=swift+swiftui+ios+xcode&tags=story&hitsPerPage=30';
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HN Algolia: HTTP ${res.status}`);
  const json = await res.json();
  return (json.hits || []).map((h) => ({
    id: `hn-${h.objectID}`,
    title: h.title,
    url: h.url || `https://news.ycombinator.com/item?id=${h.objectID}`,
    commentsUrl: `https://news.ycombinator.com/item?id=${h.objectID}`,
    source: 'Hacker News',
    sourceType: 'hn',
    score: h.points,
    numComments: h.num_comments,
    author: h.author,
    timestamp: new Date(h.created_at).getTime(),
  }));
}

// ─── Aggregate ────────────────────────────────────────────────────────────────

async function fetchAll() {
  const tasks = [
    ...REDDIT_SUBS.map(({ sub, label }) =>
      fetchReddit(sub, label).catch((e) => { console.error(e.message); return []; })
    ),
    ...RSS_FEEDS.map(({ url, label, type }) =>
      fetchRSS(url, label, type).catch((e) => { console.error(e.message); return []; })
    ),
    fetchHN().catch((e) => { console.error(e.message); return []; }),
  ];

  const results = await Promise.all(tasks);
  const flat = results.flat();

  // Deduplicate by URL
  const seen = new Set();
  const deduped = flat.filter((item) => {
    if (seen.has(item.url)) return false;
    seen.add(item.url);
    return true;
  });

  // Sort newest first
  deduped.sort((a, b) => b.timestamp - a.timestamp);
  return deduped;
}

// ─── Cache (5-minute TTL) ─────────────────────────────────────────────────────

let cache = { data: null, fetchedAt: 0 };
const CACHE_TTL_MS = 5 * 60 * 1000;

async function getCachedNews() {
  const now = Date.now();
  if (cache.data && now - cache.fetchedAt < CACHE_TTL_MS) {
    return { items: cache.data, fetchedAt: cache.fetchedAt, cached: true };
  }
  const items = await fetchAll();
  cache = { data: items, fetchedAt: now };
  return { items, fetchedAt: now, cached: false };
}

// ─── Routes ───────────────────────────────────────────────────────────────────

app.use(express.static('public'));

app.get('/api/news', async (req, res) => {
  try {
    const result = await getCachedNews();
    res.json(result);
  } catch (err) {
    console.error('Fatal error fetching news:', err);
    res.status(500).json({ error: 'Failed to fetch news' });
  }
});

// Force-refresh endpoint (bypasses cache)
app.get('/api/refresh', async (req, res) => {
  try {
    cache = { data: null, fetchedAt: 0 };
    const result = await getCachedNews();
    res.json(result);
  } catch (err) {
    console.error('Fatal error refreshing news:', err);
    res.status(500).json({ error: 'Failed to refresh news' });
  }
});

app.listen(PORT, () => {
  console.log(`iOS News running at http://localhost:${PORT}`);
});
