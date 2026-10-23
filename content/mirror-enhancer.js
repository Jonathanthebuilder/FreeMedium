/**
 * FreeMedium — Mirror Enhancer, Auto-Fallback Detector & Copy as Markdown
 * Runs on freedium.cfd, freedium-mirror.cfd, freedium-mirror-web.vercel.app, and archive.*
 */

(function () {
  'use strict';

  const TITLE_SUFFIX = ' — Freedium Mirror';

  // Apply purification immediately at document_start based on settings
  chrome.storage.local.get('settings').then(({ settings = {} }) => {
    const hidePopups = settings.hideMirrorPopups !== false;
    if (hidePopups && document.documentElement) {
      document.documentElement.classList.add('fm-purify-enabled');
    }
  }).catch(() => {
    if (document.documentElement) {
      document.documentElement.classList.add('fm-purify-enabled');
    }
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
   * Checks if the mirror returned an error / offline page (ported from WebViewActivity.java).
   */
  function checkMirrorFailure() {
    const bodyText = (document.body && document.body.innerText) || '';
    const title = (document.title || '').trim();
    const lowerTitle = title.toLowerCase();

    if (bodyText.includes('Reconnect to read new articles')) {
      return { failed: true, reason: 'Freedium offline service worker error' };
    }
    if (bodyText.includes('Could not load this article') || bodyText.includes('Unable to fetch the article')) {
      return { failed: true, reason: 'Mirror failed to fetch article' };
    }
    if (
      lowerTitle === '404' ||
      lowerTitle === 'error' ||
      lowerTitle.includes('not available') ||
      lowerTitle.includes('can\'t be reached') ||
      lowerTitle.includes('502 bad gateway') ||
      lowerTitle.includes('504 gateway time-out')
    ) {
      return { failed: true, reason: `HTTP error (${title})` };
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

  function showToast(msg) {
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.classList.add('visible');
    setTimeout(() => toastEl.classList.remove('visible'), 2500);
  }

  async function copyMarkdownFlow(originalUrl) {
    const md = extractArticleMarkdown();
    if (!md) {
      showToast('Could not extract article text');
      return { ok: false };
    }
    const sourceUrl = originalUrl || window.location.href;
    const finalMd = `${md}\n\n---\n\nSource: ${sourceUrl}\n`;
    try {
      await navigator.clipboard.writeText(finalMd);
      showToast('Copied article as Markdown!');
      return { ok: true };
    } catch {
      showToast('Clipboard write failed');
      return { ok: false };
    }
  }

  /**
   * Injects a sleek, non-intrusive floating reader toolbar on the mirror page.
   * Allows 1-click Copy as Markdown, Bookmarking, Switching Mirror, or viewing Original URL.
   */
  async function mountMirrorToolbar() {
    if (toolbarHost) return;

    const tabData = await chrome.runtime.sendMessage({
      type: 'GET_TAB_STATE',
      url: window.location.href
    });

    const originalUrl = (tabData && tabData.originalUrl) || window.location.href;
    let isBookmarked = Boolean(tabData && tabData.isBookmarked);

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
    mdBtn.title = 'Copy full article as Markdown (Alt+M)';
    mdBtn.textContent = 'Copy Markdown';
    mdBtn.addEventListener('click', () => copyMarkdownFlow(originalUrl));

    // Bookmark button
    const bmBtn = document.createElement('button');
    bmBtn.className = 'fm-btn' + (isBookmarked ? ' bookmarked' : '');
    bmBtn.title = 'Save article to FreeMedium Bookmarks';
    bmBtn.textContent = isBookmarked ? '★ Saved' : '☆ Save';
    bmBtn.addEventListener('click', async () => {
      const res = await chrome.runtime.sendMessage({
        type: 'TOGGLE_BOOKMARK',
        url: originalUrl,
        title: cleanTitle(document.title)
      });
      if (res && res.ok) {
        isBookmarked = res.bookmarked;
        bmBtn.textContent = isBookmarked ? '★ Saved' : '☆ Save';
        bmBtn.classList.toggle('bookmarked', isBookmarked);
        showToast(isBookmarked ? 'Saved to bookmarks' : 'Removed from bookmarks');
      }
    });

    // Switch Mirror button
    const switchBtn = document.createElement('button');
    switchBtn.className = 'fm-btn';
    switchBtn.title = 'Current mirror slow or broken? Switch to next mirror';
    switchBtn.textContent = '↻ Next Mirror';
    switchBtn.addEventListener('click', () => {
      showToast('Switching to next mirror...');
      chrome.runtime.sendMessage({
        type: 'MIRROR_LOAD_FAILED',
        url: window.location.href,
        reason: 'User requested next mirror',
        manualSwitch: true
      });
    });

    // Original article link
    const origBtn = document.createElement('button');
    origBtn.className = 'fm-btn';
    origBtn.title = 'Open original publisher URL in new tab';
    origBtn.textContent = '↗ Original';
    origBtn.addEventListener('click', () => {
      window.open(originalUrl, '_blank', 'noopener');
    });

    // Dismiss button
    const closeBtn = document.createElement('button');
    closeBtn.className = 'fm-btn';
    closeBtn.title = 'Hide toolbar';
    closeBtn.textContent = '✕';
    closeBtn.addEventListener('click', () => {
      toolbarHost.style.display = 'none';
    });

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

  // Listen for Copy as Markdown or Toast messages from Popup / Service Worker
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === 'COPY_MARKDOWN') {
      copyMarkdownFlow().then(res => sendResponse(res));
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
