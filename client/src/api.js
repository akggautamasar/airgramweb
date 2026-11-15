export async function apiFetch(url, options = {}) {
  const res = await fetch(url, {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data;
}

const PREFS_KEY = 'airgram_prefs_v1';
const RESUME_KEY = 'airgram_resume_v1';
const BOOKMARKS_KEY = 'airgram_bookmarks_v1';
const PDF_PAGE_KEY = 'airgram_pdf_page_v1';
const PDF_TOTAL_KEY = 'airgram_pdf_total_v1';
const RECENT_KEY = 'airgram_recent_v1';

const DEFAULT_PREFS = {
  theme: 'dark',
  streamingMode: 'fast_web',
  loadThumbnails: true,
  suspendThumbsOnPlay: true,
  playbackSpeed: 1,
  viewMode: 'grid',
};

export function loadPrefs() {
  try {
    return { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function savePrefs(next) {
  localStorage.setItem(PREFS_KEY, JSON.stringify(next));
}

export function getResumeTime(chatId, msgId) {
  try {
    const map = JSON.parse(localStorage.getItem(RESUME_KEY) || '{}');
    return Number(map[`${chatId}_${msgId}`] || 0);
  } catch {
    return 0;
  }
}

export function setResumeTime(chatId, msgId, seconds) {
  try {
    const map = JSON.parse(localStorage.getItem(RESUME_KEY) || '{}');
    map[`${chatId}_${msgId}`] = Math.floor(seconds);
    localStorage.setItem(RESUME_KEY, JSON.stringify(map));
  } catch {}
}

export function getPdfPage(chatId, msgId) {
  try {
    const map = JSON.parse(localStorage.getItem(PDF_PAGE_KEY) || '{}');
    return Number(map[`${chatId}_${msgId}`] || 1);
  } catch {
    return 1;
  }
}

export function getPdfTotal(chatId, msgId) {
  try {
    const map = JSON.parse(localStorage.getItem(PDF_TOTAL_KEY) || '{}');
    return Number(map[`${chatId}_${msgId}`] || 0);
  } catch {
    return 0;
  }
}

export function setPdfPage(chatId, msgId, page, total = 0) {
  try {
    const map = JSON.parse(localStorage.getItem(PDF_PAGE_KEY) || '{}');
    map[`${chatId}_${msgId}`] = page;
    localStorage.setItem(PDF_PAGE_KEY, JSON.stringify(map));
    if (total > 0) {
      const tmap = JSON.parse(localStorage.getItem(PDF_TOTAL_KEY) || '{}');
      tmap[`${chatId}_${msgId}`] = total;
      localStorage.setItem(PDF_TOTAL_KEY, JSON.stringify(tmap));
    }
  } catch {}
}

export function loadRecentItems() {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
  } catch {
    return [];
  }
}

export function recordRecentItem(item) {
  if (!item) return [];
  const key = `${item.chatId}_${item.id}`;
  const list = loadRecentItems().filter((x) => `${x.chatId}_${x.id}` !== key);
  const next = [{ ...item, openedAt: Date.now() }, ...list].slice(0, 12);
  localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  return next;
}

export function loadBookmarks() {
  try {
    return JSON.parse(localStorage.getItem(BOOKMARKS_KEY) || '[]');
  } catch {
    return [];
  }
}

export function toggleBookmark(item) {
  const list = loadBookmarks();
  const key = `${item.chatId}_${item.id}`;
  const exists = list.some((b) => `${b.chatId}_${b.id}` === key);
  const next = exists ? list.filter((b) => `${b.chatId}_${b.id}` !== key) : [item, ...list];
  localStorage.setItem(BOOKMARKS_KEY, JSON.stringify(next));
  return next;
}

export function formatBytes(bytes) {
  const b = Number(bytes || 0);
  if (b <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(b) / Math.log(1024)));
  return `${(b / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export function formatDuration(sec) {
  const s = Math.max(0, Math.floor(Number(sec || 0)));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rem = s % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(rem)}` : `${m}:${pad(rem)}`;
}

export function formatDate(unixSec) {
  if (!unixSec) return 'Unknown';
  return new Date(unixSec * 1000).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function streamUrl(chatId, msgId, mode = 'fast_web', download = false) {
  return `/api/stream/${encodeURIComponent(chatId)}/${encodeURIComponent(msgId)}?mode=${encodeURIComponent(mode)}${download ? '&download=1' : ''}`;
}
