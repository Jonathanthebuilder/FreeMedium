/**
 * FreeMedium — Service Worker (Manifest V3)
 * Handles mirror routing, auto-fallback state machine, context menus,
 * keyboard shortcuts, and storage synchronization.
 */

const MIRRORS = [
  { label: 'Freedium Mirror', value: 'freedium_mirror', base: 'https://freedium-mirror.cfd/' },
  { label: 'Freedium', value: 'freedium', base: 'https://freedium.cfd/' },
  { label: 'Freedium Web', value: 'freedium_web', base: 'https://freedium-mirror-web.vercel.app/read?url=' },
  { label: 'Archive.is (Newest)', value: 'archive_newest', base: 'https://archive.is/newest/' },
  { label: 'Archive.is (Oldest)', value: 'archive_oldest', base: 'https://archive.is/oldest/' }
];

const NON_MEDIUM_HOSTS = [
  'nytimes.com', 'washingtonpost.com', 'bloomberg.com',
  'reuters.com', 'economist.com', 'ft.com'
];

const DEFAULT_SETTINGS = {
  mirror: 'freedium_mirror',
  autoUnlockPaywall: true,
  showFloatingButton: true,
  autoFallback: true,
  hideMirrorPopups: true,
  openInNewTab: false
};

const MAX_HISTORY = 50;

/**
 * Checks if a specific mirror supports the given article URL.
 * `freedium_web` only supports Medium; other Freedium & Archive mirrors support all 7 publishers.
 */
function mirrorSupports(mirrorValue, articleUrl) {
  if (mirrorValue !== 'freedium_web' || !articleUrl) return true;
  try {
    const host = new URL(articleUrl).hostname.toLowerCase();
    for (const pub of NON_MEDIUM_HOSTS) {
      if (host === pub || host.endsWith('.' + pub)) return false;
    }
    return true;
  } catch {
    return true;
  }
}

/**
 * Builds the full target URL for a mirror and article URL.
 */
function buildMirrorUrl(mirrorValue, articleUrl) {
  const found = MIRRORS.find(m => m.value === mirrorValue) || MIRRORS[0];
  return found.base.endsWith('=')
    ? found.base + encodeURIComponent(articleUrl)
    : found.base + articleUrl;
}

/**
 * Gets the next supported mirror in the fallback ring.
 */
function getNextSupportedMirrorIndex(currentIndex, articleUrl) {
  let next = currentIndex;
  do {
    next = (next + 1) % MIRRORS.length;
  } while (next !== currentIndex && !mirrorSupports(MIRRORS[next].value, articleUrl));
  return next;
}

/**
 * Extracts original article URL if user is already on a mirror URL.
 */
function extractOriginalUrl(rawUrl) {
  if (!rawUrl) return '';
  try {
    const u = new URL(rawUrl);
    if (u.hostname === 'freedium-mirror-web.vercel.app') {
      const q = u.searchParams.get('url');
      if (q) return q;
    }
    if (
      u.hostname === 'freedium.cfd' ||
      u.hostname.endsWith('.freedium.cfd') ||
      u.hostname === 'freedium-mirror.cfd' ||
      u.hostname.endsWith('.freedium-mirror.cfd')
    ) {
      const path = u.pathname.replace(/^\/+/, '');
      if (path.startsWith('http://') || path.startsWith('https://')) {
        return path + u.search;
      }
      if (path.includes('.')) {
        return 'https://' + path + u.search;
      }
    }
    if (u.hostname.startsWith('archive.')) {
      const m = u.pathname.match(/^\/(?:newest|oldest|time\/[^/]+)\/(https?:\/\/.+)$/);
      if (m) return m[1] + u.search;
    }
  } catch {
    // ignore invalid URL
  }
  return rawUrl;
}

async function getSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  return { ...DEFAULT_SETTINGS, ...(settings || {}) };
}

async function recordHistory(articleUrl, title = '') {
  const cleanUrl = extractOriginalUrl(articleUrl);
  if (!cleanUrl || !cleanUrl.startsWith('http')) return;
  let host = 'article';
  try {
    host = new URL(cleanUrl).hostname.replace(/^www\./, '');
  } catch {
    // ignore
  }
  const { history = [] } = await chrome.storage.local.get('history');
  const existing = history.find(item => item.url === cleanUrl);
  const finalTitle = title || (existing && existing.title) || cleanUrl;
  const updated = [
    { url: cleanUrl, title: finalTitle, host, ts: Date.now() },
    ...history.filter(item => item.url !== cleanUrl)
  ].slice(0, MAX_HISTORY);
  await chrome.storage.local.set({ history: updated });
}

/**
 * Initiates an unlock for a given article URL on a target tab (or new tab).
 */
async function unlockArticle(rawUrl, sourceTabId, forceMirrorValue = null, forceSameTab = null) {
  const originalUrl = extractOriginalUrl(rawUrl);
  if (!originalUrl || !originalUrl.startsWith('http')) return { ok: false, error: 'Invalid URL' };

  const settings = await getSettings();
  let chosenMirrorValue = forceMirrorValue || settings.mirror || 'freedium_mirror';
  let startIndex = MIRRORS.findIndex(m => m.value === chosenMirrorValue);
  if (startIndex < 0) startIndex = 0;

  if (!mirrorSupports(MIRRORS[startIndex].value, originalUrl)) {
    startIndex = getNextSupportedMirrorIndex(startIndex, originalUrl);
  }

  const targetUrl = buildMirrorUrl(MIRRORS[startIndex].value, originalUrl);
  await recordHistory(originalUrl);

  const openNew = forceSameTab === true ? false : (forceSameTab === false ? true : settings.openInNewTab);
  let targetTabId = sourceTabId;

  if (openNew || !sourceTabId) {
    const newTab = await chrome.tabs.create({ url: targetUrl, active: true });
    targetTabId = newTab.id;
  } else {
    await chrome.tabs.update(sourceTabId, { url: targetUrl });
  }

  if (targetTabId) {
    const sessionKey = `unlock_state_${targetTabId}`;
    await chrome.storage.session.set({
      [sessionKey]: {
        originalUrl,
        startMirrorIndex: startIndex,
        currentMirrorIndex: startIndex,
        status: 'loading',
        startedAt: Date.now()
      }
    });
    if (settings.autoFallback && !MIRRORS[startIndex].value.startsWith('archive_')) {
      await chrome.alarms.create(`fallback_timeout_${targetTabId}`, { delayInMinutes: 0.25 }); // 15 seconds
    }
  }

  return { ok: true, targetUrl, mirror: MIRRORS[startIndex] };
}

/**
 * Switches a tab to the next available mirror when the current mirror fails or times out.
 */
async function tryNextMirrorForTab(tabId, reason = 'failed') {
  const settings = await getSettings();
  const sessionKey = `unlock_state_${tabId}`;
  const data = await chrome.storage.session.get(sessionKey);
  const state = data[sessionKey];
  if (!state || !state.originalUrl) return { ok: false, error: 'No active unlock state' };

  await chrome.alarms.clear(`fallback_timeout_${tabId}`);

  const nextIndex = getNextSupportedMirrorIndex(state.currentMirrorIndex, state.originalUrl);
  if (nextIndex === state.startMirrorIndex) {
    await chrome.storage.session.set({
      [sessionKey]: { ...state, status: 'exhausted', lastReason: reason }
    });
    return { ok: false, exhausted: true };
  }

  const nextMirror = MIRRORS[nextIndex];
  const nextUrl = buildMirrorUrl(nextMirror.value, state.originalUrl);

  await chrome.storage.session.set({
    [sessionKey]: {
      ...state,
      currentMirrorIndex: nextIndex,
      status: 'loading',
      lastReason: reason,
      startedAt: Date.now()
    }
  });

  if (settings.autoFallback && !nextMirror.value.startsWith('archive_')) {
    await chrome.alarms.create(`fallback_timeout_${tabId}`, { delayInMinutes: 0.25 });
  }

  try {
    await chrome.tabs.update(tabId, { url: nextUrl });
    return { ok: true, mirror: nextMirror, targetUrl: nextUrl };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

// Setup Context Menus on install
chrome.runtime.onInstalled.addListener(async () => {
  const { settings } = await chrome.storage.local.get('settings');
  if (!settings) {
    await chrome.storage.local.set({ settings: DEFAULT_SETTINGS });
  }

  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'freemedium-unlock-page',
      title: 'Unlock this page with FreeMedium',
      contexts: ['page']
    });
    chrome.contextMenus.create({
      id: 'freemedium-unlock-link',
      title: 'Unlock link with FreeMedium',
      contexts: ['link']
    });
    chrome.contextMenus.create({
      id: 'freemedium-copy-markdown',
      title: 'Copy article as Markdown',
      contexts: ['page']
    });
  });
});

// Handle Context Menu clicks with visual toast confirmation
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab || !tab.id) return;

  if (info.menuItemId === 'freemedium-unlock-page') {
    const pageUrl = info.pageUrl || tab.url;
    await showTabToast(tab.id, 'Unlocking article via FreeMedium...');
    await unlockArticle(pageUrl, tab.id);
  } else if (info.menuItemId === 'freemedium-unlock-link') {
    const linkUrl = info.linkUrl;
    await showTabToast(tab.id, 'Opening unlocked link in new tab...');
    await unlockArticle(linkUrl, tab.id, null, false);
  } else if (info.menuItemId === 'freemedium-copy-markdown') {
    await triggerCopyMarkdownInTab(tab.id);
  }
});

// Handle Keyboard Shortcuts
chrome.commands.onCommand.addListener(async (command) => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) return;

  if (command === 'unlock-current-article' && tab.url) {
    await showTabToast(tab.id, 'Unlocking article via FreeMedium...');
    await unlockArticle(tab.url, tab.id);
  } else if (command === 'copy-article-markdown') {
    await triggerCopyMarkdownInTab(tab.id);
  }
});

// Handle Alarm Timeouts for Mirror Auto-Fallback
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (!alarm.name.startsWith('fallback_timeout_')) return;
  const tabId = Number(alarm.name.replace('fallback_timeout_', ''));
  if (!tabId) return;

  const sessionKey = `unlock_state_${tabId}`;
  const data = await chrome.storage.session.get(sessionKey);
  const state = data[sessionKey];
  if (state && state.status === 'loading') {
    await tryNextMirrorForTab(tabId, 'Mirror timed out (15s)');
  }
});

// Monitor tab status for HTTP 5xx or network error pages if needed
chrome.tabs.onRemoved.addListener(async (tabId) => {
  await chrome.storage.session.remove(`unlock_state_${tabId}`);
  await chrome.alarms.clear(`fallback_timeout_${tabId}`);
});

async function showTabToast(tabId, message) {
  try {
    await chrome.tabs.sendMessage(tabId, { type: 'SHOW_TOAST', message });
  } catch {
    // Content script might not be injected on arbitrary pages; inject a minimal toast
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        func: (msg) => {
          const el = document.createElement('div');
          el.textContent = msg;
          Object.assign(el.style, {
            position: 'fixed',
            bottom: '24px',
            right: '24px',
            zIndex: '2147483647',
            background: '#10b981',
            color: '#050505',
            padding: '10px 16px',
            borderRadius: '10px',
            fontFamily: 'system-ui, -apple-system, sans-serif',
            fontSize: '13px',
            fontWeight: '600',
            boxShadow: '0 8px 24px rgba(0,0,0,0.35)'
          });
          document.body.appendChild(el);
          setTimeout(() => el.remove(), 2500);
        },
        args: [message]
      });
    } catch {
      // Cannot inject on chrome:// pages
    }
  }
}

async function triggerCopyMarkdownInTab(tabId) {
  try {
    const response = await chrome.tabs.sendMessage(tabId, { type: 'COPY_MARKDOWN' });
    return response || { ok: false };
  } catch {
    return { ok: false, error: 'Cannot extract Markdown on this page' };
  }
}

// Message listener (async/await wrapped with return true)
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      const tabId = message.tabId || (sender.tab && sender.tab.id);

      switch (message.type) {
        case 'UNLOCK_URL': {
          const res = await unlockArticle(
            message.url,
            tabId,
            message.mirror || null,
            message.sameTab ?? null
          );
          sendResponse(res);
          break;
        }

        case 'MIRROR_LOAD_SUCCESS': {
          if (tabId) {
            await chrome.alarms.clear(`fallback_timeout_${tabId}`);
            const sessionKey = `unlock_state_${tabId}`;
            const data = await chrome.storage.session.get(sessionKey);
            const existing = data[sessionKey] || {};
            const origUrl = existing.originalUrl || extractOriginalUrl(message.url || (sender.tab && sender.tab.url));
            await chrome.storage.session.set({
              [sessionKey]: {
                ...existing,
                originalUrl: origUrl,
                status: 'loaded',
                title: message.title || ''
              }
            });
            if (origUrl) {
              await recordHistory(origUrl, message.title || '');
            }
          }
          sendResponse({ ok: true });
          break;
        }

        case 'MIRROR_LOAD_FAILED': {
          if (tabId) {
            const settings = await getSettings();
            if (settings.autoFallback || message.manualSwitch) {
              const sessionKey = `unlock_state_${tabId}`;
              const data = await chrome.storage.session.get(sessionKey);
              if (!data[sessionKey] && message.url) {
                const orig = extractOriginalUrl(message.url);
                const curIdx = MIRRORS.findIndex(m => message.url.startsWith(m.base));
                await chrome.storage.session.set({
                  [sessionKey]: {
                    originalUrl: orig,
                    startMirrorIndex: curIdx >= 0 ? curIdx : 0,
                    currentMirrorIndex: curIdx >= 0 ? curIdx : 0,
                    status: 'loading'
                  }
                });
              }
              const res = await tryNextMirrorForTab(tabId, message.reason || 'Mirror error');
              sendResponse(res);
              break;
            }
          }
          sendResponse({ ok: false });
          break;
        }

        case 'SWITCH_SPECIFIC_MIRROR': {
          if (tabId && message.mirror) {
            const sessionKey = `unlock_state_${tabId}`;
            const data = await chrome.storage.session.get(sessionKey);
            const state = data[sessionKey];
            const origUrl = (state && state.originalUrl) || extractOriginalUrl(message.currentUrl || '');
            if (origUrl) {
              const res = await unlockArticle(origUrl, tabId, message.mirror, true);
              sendResponse(res);
              break;
            }
          }
          sendResponse({ ok: false });
          break;
        }

        case 'GET_TAB_STATE': {
          if (!tabId) {
            sendResponse({ state: null });
            break;
          }
          const sessionKey = `unlock_state_${tabId}`;
          const data = await chrome.storage.session.get(sessionKey);
          const settings = await getSettings();
          const { bookmarks = [] } = await chrome.storage.local.get('bookmarks');
          const origUrl = (data[sessionKey] && data[sessionKey].originalUrl) || extractOriginalUrl(message.url || '');
          const isBookmarked = bookmarks.some(b => b.url === origUrl);
          sendResponse({
            state: data[sessionKey] || null,
            originalUrl: origUrl,
            isBookmarked,
            settings,
            mirrors: MIRRORS
          });
          break;
        }

        case 'TOGGLE_BOOKMARK': {
          const origUrl = extractOriginalUrl(message.url);
          if (!origUrl) {
            sendResponse({ ok: false });
            break;
          }
          const { bookmarks = [] } = await chrome.storage.local.get('bookmarks');
          const exists = bookmarks.some(b => b.url === origUrl);
          let updated;
          if (exists) {
            updated = bookmarks.filter(b => b.url !== origUrl);
          } else {
            let host = 'article';
            try {
              host = new URL(origUrl).hostname.replace(/^www\./, '');
            } catch {
              // ignore
            }
            updated = [
              { url: origUrl, title: message.title || origUrl, host, ts: Date.now() },
              ...bookmarks
            ];
          }
          await chrome.storage.local.set({ bookmarks: updated });
          sendResponse({ ok: true, bookmarked: !exists, bookmarks: updated });
          break;
        }

        case 'SAVE_SCROLL_POSITION': {
          const origUrl = extractOriginalUrl(message.url);
          if (origUrl && typeof message.scrollY === 'number' && message.scrollY > 50) {
            const { positions = {} } = await chrome.storage.local.get('positions');
            positions[origUrl] = Math.round(message.scrollY);
            // Keep max 100 positions
            const keys = Object.keys(positions);
            if (keys.length > 100) {
              delete positions[keys[0]];
            }
            await chrome.storage.local.set({ positions });
          }
          sendResponse({ ok: true });
          break;
        }

        case 'GET_SCROLL_POSITION': {
          const origUrl = extractOriginalUrl(message.url);
          const { positions = {} } = await chrome.storage.local.get('positions');
          sendResponse({ scrollY: positions[origUrl] || 0 });
          break;
        }

        case 'SET_BADGE': {
          if (tabId) {
            await chrome.action.setBadgeText({ tabId, text: message.text || '' });
            if (message.text) {
              await chrome.action.setBadgeBackgroundColor({ tabId, color: message.color || '#10b981' });
            }
          }
          sendResponse({ ok: true });
          break;
        }

        default:
          sendResponse({ ok: false, error: 'Unknown message type' });
      }
    } catch (err) {
      sendResponse({ ok: false, error: String(err) });
    }
  })();
  return true;
});
