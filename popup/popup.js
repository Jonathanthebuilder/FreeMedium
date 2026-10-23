/**
 * FreeMedium — Popup Controller
 * Uses async/await for all Chrome extension APIs and coordinates with service-worker.js
 */

(function () {
  'use strict';

  const MIRROR_HOSTS = [
    'freedium.cfd',
    'freedium-mirror.cfd',
    'freedium-mirror-web.vercel.app',
    'archive.is',
    'archive.ph',
    'archive.today',
    'archive.md'
  ];

  // Progressive enhancement for <input type="checkbox" switch>
  if (!('switch' in HTMLInputElement.prototype)) {
    document.querySelectorAll('input[type="checkbox"][switch]').forEach((el) => {
      el.setAttribute('role', 'switch');
    });
  }

  const statusPill = document.getElementById('status-pill');
  const currentHostEl = document.getElementById('current-host');
  const btnUnlockCurrent = document.getElementById('btn-unlock-current');
  const btnUnlockLabel = document.getElementById('btn-unlock-label');
  const btnCopyMd = document.getElementById('btn-copy-md');
  const btnBookmark = document.getElementById('btn-bookmark');
  const bookmarkIcon = document.getElementById('bookmark-icon');
  const selectMirror = document.getElementById('select-mirror');
  const inputCustomUrl = document.getElementById('input-custom-url');
  const btnPasteUnlock = document.getElementById('btn-paste-unlock');

  const toggleAutoUnlock = document.getElementById('toggle-auto-unlock');
  const toggleFloatingBtn = document.getElementById('toggle-floating-btn');
  const toggleAutoFallback = document.getElementById('toggle-auto-fallback');
  const toggleHidePopups = document.getElementById('toggle-hide-popups');
  const toggleNewTab = document.getElementById('toggle-new-tab');

  const tabRecent = document.getElementById('tab-recent');
  const tabSaved = document.getElementById('tab-saved');
  const btnClearList = document.getElementById('btn-clear-list');
  const libraryList = document.getElementById('library-list');
  const popupToast = document.getElementById('popup-toast');

  let activeTab = null;
  let currentTabState = null;
  let activeLibraryTab = 'recent';

  function showToast(msg) {
    popupToast.textContent = msg;
    popupToast.classList.add('visible');
    setTimeout(() => popupToast.classList.remove('visible'), 2200);
  }

  function isMirrorHostname(hostname) {
    const clean = (hostname || '').toLowerCase();
    return MIRROR_HOSTS.some(m => clean === m || clean.endsWith('.' + m));
  }

  function formatDate(ts) {
    if (!ts) return '';
    return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  async function saveCurrentSettings() {
    const settings = {
      mirror: selectMirror.value,
      autoUnlockPaywall: toggleAutoUnlock.checked,
      showFloatingButton: toggleFloatingBtn.checked,
      autoFallback: toggleAutoFallback.checked,
      hideMirrorPopups: toggleHidePopups.checked,
      openInNewTab: toggleNewTab.checked
    };
    await chrome.storage.local.set({ settings });
    showToast('Settings saved');
  }

  async function renderLibrary() {
    const { history = [], bookmarks = [] } = await chrome.storage.local.get(['history', 'bookmarks']);
    const list = activeLibraryTab === 'recent' ? history : bookmarks;

    libraryList.textContent = '';

    if (!list.length) {
      const emptyLi = document.createElement('li');
      emptyLi.className = 'library-empty';
      emptyLi.textContent = activeLibraryTab === 'recent' ? 'No unlocked articles yet.' : 'No saved bookmarks yet.';
      libraryList.appendChild(emptyLi);
      return;
    }

    for (const item of list) {
      const li = document.createElement('li');
      li.className = 'library-item';

      const openBtn = document.createElement('button');
      openBtn.type = 'button';
      openBtn.className = 'library-open';
      openBtn.title = item.url;

      const titleSpan = document.createElement('span');
      titleSpan.className = 'library-title';
      titleSpan.textContent = item.title || item.url;

      const metaSpan = document.createElement('span');
      metaSpan.className = 'library-meta';
      metaSpan.textContent = `${item.host || 'article'} · ${formatDate(item.ts)}`;

      openBtn.append(titleSpan, metaSpan);
      openBtn.addEventListener('click', async () => {
        await chrome.runtime.sendMessage({
          type: 'UNLOCK_URL',
          url: item.url,
          tabId: activeTab ? activeTab.id : null,
          sameTab: false
        });
        window.close();
      });

      const actionsDiv = document.createElement('div');
      actionsDiv.className = 'library-actions';

      const isSaved = bookmarks.some(b => b.url === item.url);
      const starBtn = document.createElement('button');
      starBtn.type = 'button';
      starBtn.className = 'lib-icon-btn' + (isSaved ? ' saved' : '');
      starBtn.title = isSaved ? 'Remove bookmark' : 'Bookmark';
      starBtn.textContent = isSaved ? '★' : '☆';
      starBtn.addEventListener('click', async () => {
        await chrome.runtime.sendMessage({
          type: 'TOGGLE_BOOKMARK',
          url: item.url,
          title: item.title || item.url
        });
        await renderLibrary();
      });

      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'lib-icon-btn';
      delBtn.title = 'Remove item';
      delBtn.textContent = '✕';
      delBtn.addEventListener('click', async () => {
        if (activeLibraryTab === 'recent') {
          const updated = history.filter(h => h.url !== item.url);
          await chrome.storage.local.set({ history: updated });
        } else {
          const updated = bookmarks.filter(b => b.url !== item.url);
          await chrome.storage.local.set({ bookmarks: updated });
        }
        await renderLibrary();
      });

      actionsDiv.append(starBtn, delBtn);
      li.append(openBtn, actionsDiv);
      libraryList.appendChild(li);
    }
  }

  async function initPopup() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    activeTab = tab || null;

    const stateRes = await chrome.runtime.sendMessage({
      type: 'GET_TAB_STATE',
      tabId: activeTab ? activeTab.id : null,
      url: activeTab ? activeTab.url : ''
    });

    currentTabState = stateRes || {};
    const settings = currentTabState.settings || {};

    selectMirror.value = settings.mirror || 'freedium_mirror';
    toggleAutoUnlock.checked = settings.autoUnlockPaywall !== false;
    toggleFloatingBtn.checked = settings.showFloatingButton !== false;
    toggleAutoFallback.checked = settings.autoFallback !== false;
    toggleHidePopups.checked = settings.hideMirrorPopups !== false;
    toggleNewTab.checked = Boolean(settings.openInNewTab);

    if (activeTab && activeTab.url && activeTab.url.startsWith('http')) {
      try {
        const u = new URL(activeTab.url);
        currentHostEl.textContent = u.hostname.replace(/^www\./, '');
        if (isMirrorHostname(u.hostname)) {
          statusPill.textContent = 'Reading on Mirror';
          statusPill.classList.add('is-mirror');
          btnUnlockLabel.textContent = 'Switch to Next Mirror';
        } else {
          statusPill.textContent = 'Ready to Unlock';
          btnUnlockLabel.textContent = 'Unlock Current Tab';
        }
      } catch {
        currentHostEl.textContent = 'Web Page';
      }
    } else {
      currentHostEl.textContent = 'System / Empty Tab';
      btnUnlockCurrent.disabled = true;
    }

    const isSaved = Boolean(currentTabState.isBookmarked);
    bookmarkIcon.textContent = isSaved ? '★' : '☆';
    btnBookmark.classList.toggle('saved', isSaved);

    await renderLibrary();
  }

  // Event Listeners
  btnUnlockCurrent.addEventListener('click', async () => {
    if (!activeTab || !activeTab.url) return;
    try {
      const u = new URL(activeTab.url);
      if (isMirrorHostname(u.hostname)) {
        await chrome.runtime.sendMessage({
          type: 'MIRROR_LOAD_FAILED',
          tabId: activeTab.id,
          url: activeTab.url,
          reason: 'Manual switch from popup',
          manualSwitch: true
        });
        window.close();
        return;
      }
    } catch {
      // ignore
    }
    await chrome.runtime.sendMessage({
      type: 'UNLOCK_URL',
      tabId: activeTab.id,
      url: activeTab.url,
      mirror: selectMirror.value
    });
    window.close();
  });

  btnCopyMd.addEventListener('click', async () => {
    if (!activeTab || !activeTab.id) return;
    try {
      const res = await chrome.tabs.sendMessage(activeTab.id, { type: 'COPY_MARKDOWN' });
      if (res && res.ok) {
        showToast('Copied article as Markdown!');
      } else {
        showToast('Open an article first to copy Markdown');
      }
    } catch {
      showToast('Cannot extract Markdown on this tab');
    }
  });

  btnBookmark.addEventListener('click', async () => {
    if (!activeTab || !activeTab.url || !activeTab.url.startsWith('http')) return;
    const res = await chrome.runtime.sendMessage({
      type: 'TOGGLE_BOOKMARK',
      url: activeTab.url,
      title: activeTab.title || activeTab.url
    });
    if (res && res.ok) {
      bookmarkIcon.textContent = res.bookmarked ? '★' : '☆';
      btnBookmark.classList.toggle('saved', res.bookmarked);
      showToast(res.bookmarked ? 'Saved to bookmarks' : 'Removed from bookmarks');
      await renderLibrary();
    }
  });

  selectMirror.addEventListener('change', async () => {
    await saveCurrentSettings();
    if (activeTab && activeTab.url) {
      try {
        const u = new URL(activeTab.url);
        if (isMirrorHostname(u.hostname)) {
          await chrome.runtime.sendMessage({
            type: 'SWITCH_SPECIFIC_MIRROR',
            tabId: activeTab.id,
            mirror: selectMirror.value,
            currentUrl: activeTab.url
          });
        }
      } catch {
        // ignore
      }
    }
  });

  const unlockCustomInput = async () => {
    let val = inputCustomUrl.value.trim();
    if (!val) {
      try {
        const clip = await navigator.clipboard.readText();
        if (clip && clip.trim().startsWith('http')) {
          val = clip.trim();
          inputCustomUrl.value = val;
        }
      } catch {
        // ignore
      }
    }
    if (!val || !val.startsWith('http')) {
      showToast('Enter a valid http/https article URL');
      return;
    }
    await chrome.runtime.sendMessage({
      type: 'UNLOCK_URL',
      tabId: activeTab ? activeTab.id : null,
      url: val,
      mirror: selectMirror.value
    });
    window.close();
  };

  btnPasteUnlock.addEventListener('click', unlockCustomInput);
  inputCustomUrl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') unlockCustomInput();
  });

  [toggleAutoUnlock, toggleFloatingBtn, toggleAutoFallback, toggleHidePopups, toggleNewTab].forEach((el) => {
    el.addEventListener('change', saveCurrentSettings);
  });

  tabRecent.addEventListener('click', async () => {
    activeLibraryTab = 'recent';
    tabRecent.classList.add('active');
    tabRecent.setAttribute('aria-selected', 'true');
    tabSaved.classList.remove('active');
    tabSaved.setAttribute('aria-selected', 'false');
    await renderLibrary();
  });

  tabSaved.addEventListener('click', async () => {
    activeLibraryTab = 'saved';
    tabSaved.classList.add('active');
    tabSaved.setAttribute('aria-selected', 'true');
    tabRecent.classList.remove('active');
    tabRecent.setAttribute('aria-selected', 'false');
    await renderLibrary();
  });

  btnClearList.addEventListener('click', async () => {
    if (activeLibraryTab === 'recent') {
      await chrome.storage.local.set({ history: [] });
      showToast('Cleared recent history');
    } else {
      await chrome.storage.local.set({ bookmarks: [] });
      showToast('Cleared saved bookmarks');
    }
    await renderLibrary();
  });

  initPopup();
})();
