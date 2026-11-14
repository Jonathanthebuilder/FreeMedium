/**
 * FreeMedium — Mirror Enhancer, Auto-Fallback Detector & Copy as Markdown
 * Runs on freedium.cfd, freedium-mirror.cfd, freedium-mirror-web.vercel.app, and archive.*
 */

(function () {
  'use strict';

  // Shared i18n layer (lib/i18n.js). The literal fallbacks keep the script
  // usable in isolation and guarantee English output is unchanged.
  const i18n = typeof FM_I18N !== 'undefined' ? FM_I18N : null;

  function t(key, params, fallback) {
    if (i18n && typeof i18n.t === 'function') return i18n.t(key, params);
    return fallback === undefined ? key : fallback;
  }

  function initI18n() {
    if (!i18n || typeof i18n.initFromStorage !== 'function') return Promise.resolve();
    return Promise.resolve(i18n.initFromStorage()).catch(() => {});
  }

  function setUiLanguage(settings) {
    if (i18n && typeof i18n.setLanguage === 'function') {
      i18n.setLanguage(settings && settings.language);
    }
  }

  const i18nReady = initI18n();

  const TITLE_SUFFIX = ' — Freedium Mirror';

  // Donation/support modals used by the mirror sites. They are ordinary
  // shadcn-style dialogs, so match them by their copy instead of CSS classes.
  const DONATION_MARKERS = [
    'Support Freedium',
    'Donate via PayPal',
    'OTHER WAYS TO SUPPORT',
    'Buy Me a Coffee',
    'Buy me a coffee'
  ];
  const DIALOG_SELECTOR = '[data-slot="dialog-content"], [aria-modal="true"], [role="dialog"]';

  let purifyEnabled = true;
  let modalObserver = null;
  let modalTimer = null;

  /**
   * Removes the donation/support modal and undoes the scroll/pointer lock that
   * the dialog library applies to <body> while a modal is open.
   */
  function removeDonationModals() {
    if (!purifyEnabled || !document.body) return;
    let purged = false;

    document.querySelectorAll(DIALOG_SELECTOR).forEach((dialog) => {
      if (dialog.hasAttribute('data-fm-purged')) return;
      const text = dialog.textContent || '';
      if (!DONATION_MARKERS.some((marker) => text.includes(marker))) return;
      dialog.setAttribute('data-fm-purged', '1');
      dialog.setAttribute('aria-hidden', 'true');
      dialog.style.setProperty('display', 'none', 'important');
      purged = true;
    });

    if (!purged) return;

    document.querySelectorAll('[data-slot="dialog-overlay"]').forEach((overlay) => {
      overlay.setAttribute('data-fm-purged', '1');
      overlay.style.setProperty('display', 'none', 'important');
    });

    for (const el of [document.body, document.documentElement]) {
      if (!el) continue;
      el.style.removeProperty('overflow');
      el.style.removeProperty('pointer-events');
      el.style.removeProperty('padding-right');
      el.style.removeProperty('--scrollbar-width');
    }
  }

  function startModalPurifier() {
    if (!purifyEnabled) return;
    removeDonationModals();

    if (!modalObserver && document.documentElement) {
      modalObserver = new MutationObserver((records) => {
        if (modalTimer !== null) return;
        let relevant = false;
        for (const record of records) {
          for (const node of record.addedNodes) {
            if (node.nodeType !== 1) continue;
            if (node.matches && node.matches(`${DIALOG_SELECTOR}, [data-slot="dialog-overlay"]`)) {
              relevant = true;
              break;
            }
          }
          if (relevant) break;
        }
        if (!relevant) return;
        modalTimer = setTimeout(() => {
          modalTimer = null;
          removeDonationModals();
        }, 100);
      });
      modalObserver.observe(document.documentElement, { childList: true, subtree: true });
    }

    // Some mirrors mount the dialog after hydration; retry a few times.
    for (const delay of [400, 1200, 3000, 6000]) {
      setTimeout(removeDonationModals, delay);
    }
  }

  // Apply purification immediately at document_start based on settings
  chrome.storage.local.get('settings').then(({ settings = {} }) => {
    setUiLanguage(settings);
    purifyEnabled = settings.hideMirrorPopups !== false;
    if (purifyEnabled && document.documentElement) {
      document.documentElement.classList.add('fm-purify-enabled');
    }
    if (purifyEnabled) startModalPurifier();
  }).catch(() => {
    if (document.documentElement) {
      document.documentElement.classList.add('fm-purify-enabled');
    }
    startModalPurifier();
  });

  /**
   * Ported and modernized from freedium-app's `copy_markdown.js`
   * Converts rendered article DOM into clean Markdown with headings, code blocks, tables, lists, and images.
   */
  function extractArticleMarkdown() {
    let TITLE = '';
    const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
    const push = (out, s) => {
      if (!s || !s.trim()) return;
      if (out.length && out[out.length - 1] === s) return;
      out.push(s);
    };
    const abs = (u) => {
      try {
        return new URL(u, document.baseURI).href;
      } catch {
        return u;
      }
    };
    const tag = (n) => String(n.tagName || '').toUpperCase();
    const skip = (n) => {
      const t = tag(n);
      if (
        t === 'SCRIPT' || t === 'STYLE' || t === 'NOSCRIPT' || t === 'NAV' ||
        t === 'BUTTON' || t === 'FORM' || t === 'SVG' || t === 'IFRAME' ||
        t === 'HEADER' || t === 'FOOTER'
      ) {
        return true;
      }
      if (n.getAttribute && (n.getAttribute('data-nosnippet') !== null || n.getAttribute('aria-hidden') === 'true')) {
        return true;
      }
      return false;
    };
    const img = (n) => {
      const src = n.getAttribute('src') || n.getAttribute('data-src') || '';
      if (!src) return '';
      const alt = (n.getAttribute('alt') || '').replace(/[[\]]/g, '');
      return `![${alt}](${abs(src)})`;
    };
    const inlineNode = (n) => {
      if (n.nodeType === 3) return n.nodeValue.replace(/\s+/g, ' ');
      if (n.nodeType !== 1 || skip(n)) return '';
      const t = tag(n);
      const inner = inline(n);
      if (t === 'BR') return '  \n';
      if (t === 'IMG') return img(n);
      if (!inner.trim()) return t === 'CODE' ? '' : inner;
      if (t === 'CODE') return '`' + inner.replace(/`/g, '') + '`';
      if (t === 'STRONG' || t === 'B') return '**' + inner + '**';
      if (t === 'EM' || t === 'I') return '*' + inner + '*';
      if (t === 'DEL' || t === 'S') return '~~' + inner + '~~';
      if (t === 'A') {
        const h = n.getAttribute('href') || '';
        return h ? `[${inner.trim()}](${abs(h)})` : inner;
      }
      return inner;
    };
    const inline = (n) => {
      let out = '';
      for (let c = n.firstChild; c; c = c.nextSibling) {
        out += inlineNode(c);
      }
      return out;
    };
    const list = (n, ordered, indent) => {
      const lines = [];
      let i = 1;
      for (let li = n.firstChild; li; li = li.nextSibling) {
        if (li.nodeType !== 1 || skip(li) || tag(li) !== 'LI') continue;
        let text = '';
        const nested = [];
        for (let c = li.firstChild; c; c = c.nextSibling) {
          if (c.nodeType === 1 && (tag(c) === 'UL' || tag(c) === 'OL')) {
            nested.push(list(c, tag(c) === 'OL', indent + '  '));
            continue;
          }
          text += inlineNode(c);
        }
        text = text.replace(/\s+/g, ' ').trim();
        if (!text && !nested.length) continue;
        lines.push(indent + (ordered ? `${i}. ` : '- ') + text);
        for (const sub of nested) {
          if (sub) lines.push(sub);
        }
        i++;
      }
      return lines.join('\n');
    };
    const codeBlock = (n) => {
      let lang = '';
      const code = n.querySelector ? n.querySelector('code') : null;
      if (code) {
        const m = (code.getAttribute('class') || '').match(/language-([A-Za-z0-9+#-]+)/);
        if (m) lang = m[1];
      }
      const text = (n.textContent || '').replace(/\s+$/, '');
      return text.trim() ? '```' + lang + '\n' + text + '\n```' : '';
    };
    const table = (n) => {
      const rows = [];
      const trs = n.getElementsByTagName('tr');
      for (let i = 0; i < trs.length; i++) {
        const cells = [];
        const kids = trs[i].children;
        for (let j = 0; j < kids.length; j++) {
          cells.push(inline(kids[j]).replace(/\s+/g, ' ').replace(/\|/g, '\\|').trim());
        }
        if (cells.length) rows.push('| ' + cells.join(' | ') + ' |');
        if (i === 0 && cells.length) {
          rows.push('| ' + cells.map(() => '---').join(' | ') + ' |');
        }
      }
      return rows.join('\n');
    };
    const block = (n, out, seenTitle) => {
      for (let c = n.firstChild; c; c = c.nextSibling) {
        if (c.nodeType === 3) {
          const t = c.nodeValue.replace(/\s+/g, ' ').trim();
          if (t) push(out, t);
          continue;
        }
        if (c.nodeType !== 1 || skip(c)) continue;
        const t2 = tag(c);
        let txt;
        if (t2 === 'H1' || t2 === 'H2' || t2 === 'H3' || t2 === 'H4' || t2 === 'H5' || t2 === 'H6') {
          txt = inline(c).replace(/\s+/g, ' ').trim();
          if (!txt) continue;
          if (TITLE && norm(txt) === TITLE && !seenTitle.hit) {
            seenTitle.hit = true;
            continue;
          }
          push(out, '#'.repeat(parseInt(t2.charAt(1), 10)) + ' ' + txt);
        } else if (t2 === 'P' || t2 === 'FIGCAPTION') {
          txt = inline(c).replace(/[ \t]+/g, ' ').trim();
          if (txt) push(out, t2 === 'FIGCAPTION' ? `*${txt}*` : txt);
        } else if (t2 === 'PRE') {
          txt = codeBlock(c);
          if (txt) push(out, txt);
        } else if (t2 === 'UL' || t2 === 'OL') {
          txt = list(c, t2 === 'OL', '');
          if (txt) push(out, txt);
        } else if (t2 === 'TABLE') {
          txt = table(c);
          if (txt) push(out, txt);
        } else if (t2 === 'BLOCKQUOTE') {
          const q = [];
          block(c, q, seenTitle);
          txt = q.join('\n\n').split('\n').map(l => ('> ' + l).replace(/\s+$/, '')).join('\n');
          if (txt.replace(/[>\s]/g, '')) push(out, txt);
        } else if (t2 === 'HR') {
          push(out, '---');
        } else if (t2 === 'IMG') {
          txt = img(c);
          if (txt) push(out, txt);
        } else {
          block(c, out, seenTitle);
        }
      }
    };
    const root = () => {
      let best = null;
      const nodes = document.querySelectorAll('.prose');
      for (let i = 0; i < nodes.length; i++) {
        if (!best || (nodes[i].textContent || '').length > (best.textContent || '').length) {
          best = nodes[i];
        }
      }
      return best || document.querySelector('article') || document.querySelector('main') || document.body;
    };

    const h = document.querySelector('article h1') || document.querySelector('main h1') || document.querySelector('h1');
    TITLE = h ? norm(h.textContent) : '';
    const r = root();
    if (!r) return null;
    const out = [];
    block(r, out, { hit: false });
    const md = out.join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
    if (!md) return null;
    return (TITLE ? `# ${TITLE}\n\n` : '') + md;
  }

  /**
   * Returns true when the mirror page already shows a substantial rendered article.
   * Used to avoid mistaking incidental strings in real content for mirror errors.
   */
  function hasRenderedArticle() {
    let best = null;
    const nodes = document.querySelectorAll('.prose');
    for (let i = 0; i < nodes.length; i++) {
      if (!best || (nodes[i].textContent || '').length > (best.textContent || '').length) {
        best = nodes[i];
      }
    }
    const candidate = best || document.querySelector('article') || document.querySelector('main');
    return Boolean(candidate && (candidate.textContent || '').length > 400);
  }

  /**
   * Checks if the mirror returned an error / offline page (ported from WebViewActivity.java).
   */
  function checkMirrorFailure() {
    const bodyText = (document.body && document.body.innerText) || '';
    const title = (document.title || '').trim();
    const lowerTitle = title.toLowerCase();

    // Real rendered article content wins over error-like strings in the page.
    if (hasRenderedArticle()) {
      return { failed: false, reason: '' };
    }

    if (bodyText.includes('Reconnect to read new articles')) {
      return { failed: true, reason: 'Freedium offline service worker error' };
    }
    if (bodyText.includes('Could not load this article') || bodyText.includes('Unable to fetch the article')) {
      return { failed: true, reason: 'Mirror failed to fetch article' };
    }

    // Only exact error titles count; article titles may legitimately contain phrases like "not available".
    const errorTitles = [
      '404',
      'error',
      '502 bad gateway',
      '504 gateway time-out',
      'service unavailable',
      'this page isn\'t working',
      'this page isn’t working'
    ];
    if (errorTitles.includes(lowerTitle)) {
      return { failed: true, reason: `HTTP error (${title})` };
    }

    // Chrome / network error pages are short and carry a specific banner.
    const trimmedBody = bodyText.trim();
    if (
      trimmedBody.length < 600 &&
      (trimmedBody.includes('This site can\'t be reached') || trimmedBody.includes('This site can’t be reached'))
    ) {
      return { failed: true, reason: 'Network error page' };
    }

    return { failed: false, reason: '' };
  }

  function cleanTitle(rawTitle) {
    let t = (rawTitle || '').trim();
    if (t.endsWith(TITLE_SUFFIX)) {
      t = t.slice(0, -TITLE_SUFFIX.length).trim();
    }
    return t;
  }

  let toolbarHost = null;
  let toastEl = null;
  let toolbarMdBtn = null;
  let toolbarBmBtn = null;
  let toolbarSwitchBtn = null;
  let toolbarOrigBtn = null;
  let toolbarCloseBtn = null;
  let toolbarBookmarked = false;

  function showToast(msg) {
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.classList.add('visible');
    setTimeout(() => toastEl.classList.remove('visible'), 2500);
  }

  /**
   * Builds the exact Markdown text copied by COPY_MARKDOWN.
   * Returns null when no article text can be extracted.
   */
  function buildMarkdownText(originalUrl) {
    const md = extractArticleMarkdown();
    if (!md) return null;
    const sourceUrl = originalUrl || window.location.href;
    return `${md}\n\n---\n\n${t('md.sourceFooter', { url: sourceUrl }, `Source: ${sourceUrl}`)}\n`;
  }

  /**
   * Last-resort clipboard fallback for pages where the async Clipboard API is blocked.
   */
  function legacyCopyToClipboard(text) {
    if (!document.body) return false;
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.top = '-9999px';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.select();
    if (textarea.setSelectionRange) {
      textarea.setSelectionRange(0, textarea.value.length);
    }
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    textarea.remove();
    return ok;
  }

  async function copyMarkdownFlow(originalUrl) {
    const finalMd = buildMarkdownText(originalUrl);
    if (!finalMd) {
      showToast(t('toast.extractFail', null, 'Could not extract article text'));
      return { ok: false };
    }
    try {
      await navigator.clipboard.writeText(finalMd);
      showToast(t('toast.copied', null, 'Copied article as Markdown!'));
      return { ok: true };
    } catch {
      if (legacyCopyToClipboard(finalMd)) {
        showToast(t('toast.copied', null, 'Copied article as Markdown!'));
        return { ok: true };
      }
      showToast(t('toast.copyFailed', null, 'Clipboard write failed'));
      return { ok: false };
    }
  }

  /**
   * Re-applies localized toolbar labels/tooltips after a live language change.
   */
  function refreshToolbarTexts() {
    if (toolbarMdBtn) {
      toolbarMdBtn.textContent = t('toolbar.copy', null, 'Copy Markdown');
      toolbarMdBtn.title = t('toolbar.copyTitle', null, 'Copy full article as Markdown (Alt+M)');
    }
    if (toolbarBmBtn) {
      toolbarBmBtn.textContent = toolbarBookmarked
        ? t('toolbar.saved', null, '★ Saved')
        : t('toolbar.save', null, '☆ Save');
      toolbarBmBtn.title = t('toolbar.saveTitle', null, 'Save article to FreeMedium Bookmarks');
    }
    if (toolbarSwitchBtn) {
      toolbarSwitchBtn.textContent = t('toolbar.next', null, '↻ Next Mirror');
      toolbarSwitchBtn.title = t('toolbar.nextTitle', null, 'Current mirror slow or broken? Switch to next mirror');
    }
    if (toolbarOrigBtn) {
      toolbarOrigBtn.textContent = t('toolbar.original', null, '↗ Original');
      toolbarOrigBtn.title = t('toolbar.originalTitle', null, 'Open original publisher URL in new tab');
    }
    if (toolbarCloseBtn) {
      toolbarCloseBtn.title = t('toolbar.hideTitle', null, 'Hide toolbar');
    }
  }

  /**
   * Injects a sleek, non-intrusive floating reader toolbar on the mirror page.
   * Allows 1-click Copy as Markdown, Bookmarking, Switching Mirror, or viewing Original URL.
   */
  async function mountMirrorToolbar() {
    if (toolbarHost) return;

    // Never render the toolbar before the language has been resolved.
    await i18nReady;

    const tabData = await chrome.runtime.sendMessage({
      type: 'GET_TAB_STATE',
      url: window.location.href
    });

    const originalUrl = (tabData && tabData.originalUrl) || window.location.href;
    let isBookmarked = Boolean(tabData && tabData.isBookmarked);
    toolbarBookmarked = isBookmarked;

    toolbarHost = document.createElement('div');
    toolbarHost.id = 'freemedium-mirror-toolbar';
    const shadow = toolbarHost.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = `
      :host {
        all: initial;
        position: fixed;
        bottom: 20px;
        right: 20px;
        z-index: 2147483646;
        font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      }
      .fm-bar {
        display: flex;
        align-items: center;
        gap: 4px;
        background: rgba(12, 12, 14, 0.92);
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
        border: 1px solid rgba(255, 255, 255, 0.14);
        border-radius: 999px;
        padding: 5px 8px;
        box-shadow: 0 10px 28px rgba(0, 0, 0, 0.45);
        color: #f5f5f5;
      }
      .fm-btn {
        all: unset;
        display: inline-flex;
        align-items: center;
        gap: 5px;
        padding: 6px 10px;
        border-radius: 999px;
        font-size: 12px;
        font-weight: 600;
        color: #e5e5e5;
        cursor: pointer;
        transition: background 0.15s ease, color 0.15s ease;
      }
      .fm-btn:hover {
        background: rgba(255, 255, 255, 0.1);
        color: #ffffff;
      }
      .fm-btn:focus-visible {
        outline: 2px solid #10b981;
        outline-offset: 2px;
      }
      .fm-btn.primary {
        background: rgba(16, 185, 129, 0.16);
        color: #34d399;
      }
      .fm-btn.primary:hover {
        background: rgba(16, 185, 129, 0.28);
      }
      .fm-btn.bookmarked {
        color: #fbbf24;
      }
      .fm-sep {
        width: 1px;
        height: 16px;
        background: rgba(255, 255, 255, 0.14);
        margin: 0 2px;
      }
      .fm-toast {
        position: fixed;
        bottom: 68px;
        right: 20px;
        background: #10b981;
        color: #050505;
        font-size: 12.5px;
        font-weight: 600;
        padding: 9px 14px;
        border-radius: 10px;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
        opacity: 0;
        transform: translateY(6px);
        transition: opacity 0.2s ease, transform 0.2s ease;
        pointer-events: none;
      }
      .fm-toast.visible {
        opacity: 1;
        transform: translateY(0);
      }
      @media (forced-colors: active) {
        .fm-bar {
          border: 2px solid ButtonText;
        }
      }
    `;

    const bar = document.createElement('div');
    bar.className = 'fm-bar';

    // Copy Markdown button
    const mdBtn = document.createElement('button');
    mdBtn.className = 'fm-btn primary';
    mdBtn.title = t('toolbar.copyTitle', null, 'Copy full article as Markdown (Alt+M)');
    mdBtn.textContent = t('toolbar.copy', null, 'Copy Markdown');
    mdBtn.addEventListener('click', () => copyMarkdownFlow(originalUrl));
    toolbarMdBtn = mdBtn;

    // Bookmark button
    const bmBtn = document.createElement('button');
    bmBtn.className = 'fm-btn' + (isBookmarked ? ' bookmarked' : '');
    bmBtn.title = t('toolbar.saveTitle', null, 'Save article to FreeMedium Bookmarks');
    bmBtn.textContent = isBookmarked ? t('toolbar.saved', null, '★ Saved') : t('toolbar.save', null, '☆ Save');
    bmBtn.addEventListener('click', async () => {
      const res = await chrome.runtime.sendMessage({
        type: 'TOGGLE_BOOKMARK',
        url: originalUrl,
        title: cleanTitle(document.title)
      });
      if (res && res.ok) {
        isBookmarked = res.bookmarked;
        toolbarBookmarked = isBookmarked;
        bmBtn.textContent = isBookmarked ? t('toolbar.saved', null, '★ Saved') : t('toolbar.save', null, '☆ Save');
        bmBtn.classList.toggle('bookmarked', isBookmarked);
        showToast(isBookmarked
          ? t('toast.bookmarkSaved', null, 'Saved to bookmarks')
          : t('toast.bookmarkRemoved', null, 'Removed from bookmarks'));
      }
    });
    toolbarBmBtn = bmBtn;

    // Switch Mirror button
    const switchBtn = document.createElement('button');
    switchBtn.className = 'fm-btn';
    switchBtn.title = t('toolbar.nextTitle', null, 'Current mirror slow or broken? Switch to next mirror');
    switchBtn.textContent = t('toolbar.next', null, '↻ Next Mirror');
    switchBtn.addEventListener('click', () => {
      showToast(t('toast.switching', null, 'Switching to next mirror...'));
      chrome.runtime.sendMessage({
        type: 'MIRROR_LOAD_FAILED',
        url: window.location.href,
        reason: 'User requested next mirror',
        manualSwitch: true
      });
    });
    toolbarSwitchBtn = switchBtn;

    // Original article link
    const origBtn = document.createElement('button');
    origBtn.className = 'fm-btn';
    origBtn.title = t('toolbar.originalTitle', null, 'Open original publisher URL in new tab');
    origBtn.textContent = t('toolbar.original', null, '↗ Original');
    origBtn.addEventListener('click', () => {
      window.open(originalUrl, '_blank', 'noopener');
    });
    toolbarOrigBtn = origBtn;

    // Dismiss button
    const closeBtn = document.createElement('button');
    closeBtn.className = 'fm-btn';
    closeBtn.title = t('toolbar.hideTitle', null, 'Hide toolbar');
    closeBtn.textContent = '✕';
    closeBtn.addEventListener('click', () => {
      toolbarHost.style.display = 'none';
    });
    toolbarCloseBtn = closeBtn;

    const sep1 = document.createElement('span');
    sep1.className = 'fm-sep';
    const sep2 = document.createElement('span');
    sep2.className = 'fm-sep';

    bar.append(mdBtn, sep1, bmBtn, switchBtn, origBtn, sep2, closeBtn);

    toastEl = document.createElement('div');
    toastEl.className = 'fm-toast';

    shadow.append(style, bar, toastEl);
    document.documentElement.appendChild(toolbarHost);
  }

  // React to live language changes without reloading the mirror page.
  if (
    typeof chrome !== 'undefined' &&
    chrome.storage &&
    chrome.storage.onChanged &&
    chrome.storage.onChanged.addListener
  ) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !changes.settings) return;
      setUiLanguage(changes.settings.newValue);
      refreshToolbarTexts();
    });
  }

  async function onMirrorReady() {
    // Wait briefly for dynamic React/Next.js mirror content (like freedium-mirror-web) to settle
    await new Promise(r => setTimeout(r, 700));

    const failure = checkMirrorFailure();
    if (failure.failed) {
      await chrome.runtime.sendMessage({
        type: 'MIRROR_LOAD_FAILED',
        url: window.location.href,
        reason: failure.reason
      });
      return;
    }

    const title = cleanTitle(document.title);
    await chrome.runtime.sendMessage({
      type: 'MIRROR_LOAD_SUCCESS',
      url: window.location.href,
      title
    });

    requestAnimationFrame(() => {
      mountMirrorToolbar();
    });

    // Restore reading scroll position if saved
    const posRes = await chrome.runtime.sendMessage({
      type: 'GET_SCROLL_POSITION',
      url: window.location.href
    });
    if (posRes && posRes.scrollY > 100) {
      setTimeout(() => {
        window.scrollTo({ top: posRes.scrollY, behavior: 'smooth' });
      }, 450);
    }

    // Periodically save reading scroll position
    let scrollTimeout = null;
    window.addEventListener('scroll', () => {
      if (scrollTimeout) clearTimeout(scrollTimeout);
      scrollTimeout = setTimeout(() => {
        chrome.runtime.sendMessage({
          type: 'SAVE_SCROLL_POSITION',
          url: window.location.href,
          scrollY: window.scrollY
        });
      }, 600);
    }, { passive: true });
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    onMirrorReady();
  } else {
    window.addEventListener('DOMContentLoaded', onMirrorReady, { once: true });
  }

  // Listen for Copy as Markdown, Markdown extraction or Toast messages from Popup / Service Worker
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === 'COPY_MARKDOWN') {
      copyMarkdownFlow().then(res => sendResponse(res));
      return true;
    }
    if (message.type === 'EXTRACT_MARKDOWN') {
      const markdown = buildMarkdownText();
      if (!markdown) {
        sendResponse({ ok: false, error: 'Could not extract article text' });
      } else {
        sendResponse({ ok: true, markdown });
      }
      return true;
    }
    if (message.type === 'SHOW_TOAST') {
      showToast(message.message || 'Done');
      sendResponse({ ok: true });
      return false;
    }
    return false;
  });
})();
