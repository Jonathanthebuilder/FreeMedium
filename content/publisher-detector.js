/**
 * FreeMedium — Publisher Detector & Floating Unlock Pill
 * Runs on Medium (and Medium publications) + NYT, WaPo, Bloomberg, Reuters, Economist, FT.
 * Detects article pages and paywalls, displays a floating Shadow DOM Unlock pill,
 * and triggers automatic unlock when a paywall is hit.
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

  // Resolved once before any UI text is created.
  const i18nReady = initI18n();

  const NON_ARTICLE_PATHS = new Set([
    '/', '/me', '/new-story', '/plans', '/membership', '/search',
    '/tag', '/topics', '/about', '/jobs', '/creators', '/m/signin'
  ]);

  const DEFAULT_SETTINGS = {
    autoUnlockPaywall: true,
    showFloatingButton: true
  };

  let pillHost = null;
  let pillButton = null;
  let pillLabel = null;
  let pillCloseBtn = null;
  let pillUnlocking = false;
  let paywallBadge = null;
  let autoUnlockTriggeredForUrl = '';
  let lastCheckedUrl = window.location.href;
  let dismissedForUrl = '';
  let evaluateTimer = null;
  let cachedSettings = { ...DEFAULT_SETTINGS };

  /**
   * Determines whether the current page is an individual article rather than a homepage/feed.
   */
  function isArticlePage() {
    const { pathname, hostname } = window.location;
    if (!pathname || pathname === '/' || NON_ARTICLE_PATHS.has(pathname)) return false;

    const cleanHost = hostname.replace(/^www\./, '').toLowerCase();

    // Check OpenGraph type first (supported across Medium, NYT, WaPo, etc.)
    const ogType = document.querySelector('meta[property="og:type"]');
    if (ogType && ogType.content === 'article') return true;

    // Medium articles typically end with a 10-12 char hex ID or contain /p/
    if (cleanHost.includes('medium.com') || document.querySelector('meta[name="twitter:app:name:iphone"][content="Medium"]')) {
      if (/-[0-9a-f]{8,12}$/i.test(pathname) || pathname.startsWith('/p/')) return true;
    }

    // Check if main <article> tag with substantial text exists
    const articleEl = document.querySelector('article');
    if (articleEl && (articleEl.textContent || '').length > 400 && pathname.split('/').filter(Boolean).length >= 1) {
      return true;
    }

    return false;
  }

  /**
   * Detects if the current article is behind a paywall / member-only gate.
   */
  function detectPaywall() {
    // 1. Medium Member-only indicators
    const tierMeta = document.querySelector('meta[property="article:tier"], meta[name="article:tier"]');
    if (tierMeta && tierMeta.content && tierMeta.content.toLowerCase() === 'locked') {
      return { locked: true, reason: t('paywall.memberOnly', null, 'Member-only story') };
    }

    // Check JSON-LD schema for isAccessibleForFree: false
    const ldScripts = document.querySelectorAll('script[type="application/ld+json"]');
    for (const s of ldScripts) {
      const txt = s.textContent || '';
      if (/"isAccessibleForFree"\s*:\s*(false|"False")/i.test(txt)) {
        return { locked: true, reason: t('paywall.subscriberOnly', null, 'Subscriber-only article') };
      }
    }

    // Cheap DOM markers first; only read body.innerText if none of them matched
    if (document.querySelector('[data-testid="paywall"], #paywall-background-color')) {
      return { locked: true, reason: t('paywall.memberOnly', null, 'Member-only story') };
    }

    // Other publishers (NYT, WaPo, FT, Economist, Bloomberg) paywall gates
    if (
      document.querySelector(
        '#gateway-content, [data-testid="paywall-overlay"], .paywall-overlay, .tp-modal, [data-qa="paywall-regwall"]'
      )
    ) {
      return { locked: true, reason: t('paywall.detected', null, 'Paywall detected') };
    }

    // Lazily read the body text only when the DOM markers did not already decide
    const bodyText = document.body ? document.body.innerText : '';
    if (
      bodyText.includes('Member-only story') && (
        bodyText.includes('Become a member to read this story') ||
        bodyText.includes('Read this story from') ||
        bodyText.includes('Create an account to read the full story')
      )
    ) {
      return { locked: true, reason: t('paywall.memberOnly', null, 'Member-only story') };
    }

    return { locked: false, reason: '' };
  }

  const BLOCK_SKIP_TAGS = new Set([
    'SCRIPT', 'STYLE', 'NAV', 'HEADER', 'FOOTER', 'BUTTON', 'FORM',
    'SVG', 'IFRAME', 'NOSCRIPT', 'TEMPLATE', 'SELECT', 'TEXTAREA', 'INPUT'
  ]);

  /**
   * Resolves a possibly relative URL against the current page.
   */
  function toAbsoluteUrl(url) {
    if (!url) return '';
    try {
      return new URL(url, window.location.href).href;
    } catch {
      return url;
    }
  }

  /**
   * Whether a DOM node should be ignored entirely when extracting Markdown.
   */
  function shouldSkipElement(el) {
    const tag = (el.tagName || '').toUpperCase();
    if (BLOCK_SKIP_TAGS.has(tag)) return true;
    if (el.getAttribute('aria-hidden') === 'true') return true;
    return false;
  }

  /**
   * Converts inline content (text nodes and inline elements) to Markdown.
   */
  function inlineToMarkdown(node) {
    if (!node) return '';
    if (node.nodeType === Node.TEXT_NODE) {
      return (node.textContent || '').replace(/\s+/g, ' ');
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return '';
    if (shouldSkipElement(node)) return '';

    const tag = node.tagName.toUpperCase();
    if (tag === 'BR') return '  \n';
    if (tag === 'IMG') {
      const src = toAbsoluteUrl(node.getAttribute('src') || '');
      if (!src) return '';
      const alt = (node.getAttribute('alt') || '').replace(/\s+/g, ' ').trim();
      return `![${alt}](${src})`;
    }
    if (tag === 'CODE') {
      const code = (node.textContent || '').replace(/\s+/g, ' ').trim();
      return code ? `\`${code}\`` : '';
    }

    const inner = inlineChildrenToMarkdown(node).trim();
    if (tag === 'STRONG' || tag === 'B') return inner ? `**${inner}**` : '';
    if (tag === 'EM' || tag === 'I') return inner ? `*${inner}*` : '';
    if (tag === 'DEL' || tag === 'S' || tag === 'STRIKE') return inner ? `~~${inner}~~` : '';
    if (tag === 'A') {
      const href = node.getAttribute('href');
      if (!href) return inner;
      return inner ? `[${inner}](${toAbsoluteUrl(href)})` : '';
    }
    return inner;
  }

  function inlineChildrenToMarkdown(el) {
    let out = '';
    for (const child of el.childNodes) out += inlineToMarkdown(child);
    return out;
  }

  /**
   * Converts a <pre> block to a fenced code block, honoring a language-* class.
   */
  function preToMarkdown(pre) {
    const codeEl = pre.querySelector('code');
    const classAttr = codeEl ? (codeEl.getAttribute('class') || '') : '';
    const langMatch = /(?:^|\s)language-([A-Za-z0-9_+#.-]+)/.exec(classAttr);
    const lang = langMatch ? langMatch[1] : '';
    let code = (codeEl || pre).textContent || '';
    code = code.replace(/^\n+|\n+$/g, '');
    return '```' + lang + '\n' + code + '\n```';
  }

  /**
   * Converts a <blockquote> to Markdown, prefixing every line with "> ".
   */
  function blockquoteToMarkdown(el) {
    const inner = walkBlocks(el, null).filter(Boolean).join('\n\n');
    if (!inner) return '';
    return inner
      .split('\n')
      .map(line => `> ${line}`)
      .join('\n');
  }

  /**
   * Converts a <ul>/<ol> to Markdown, recursing into nested lists with 2-space indentation.
   */
  function listToMarkdown(listEl, depth) {
    const ordered = listEl.tagName.toUpperCase() === 'OL';
    let counter = parseInt(listEl.getAttribute('start'), 10);
    if (!Number.isFinite(counter)) counter = 1;

    const indent = '  '.repeat(depth);
    const lines = [];

    for (const li of listEl.children) {
      if (li.tagName.toUpperCase() !== 'LI') continue;
      const marker = ordered ? `${counter++}. ` : '- ';
      const nestedLists = [];
      const extras = [];
      let inlineText = '';

      for (const child of li.childNodes) {
        if (child.nodeType === Node.ELEMENT_NODE) {
          const tag = child.tagName.toUpperCase();
          if (tag === 'UL' || tag === 'OL') {
            nestedLists.push(child);
            continue;
          }
          if (tag === 'PRE') {
            extras.push(preToMarkdown(child));
            continue;
          }
          if (tag === 'BLOCKQUOTE') {
            extras.push(blockquoteToMarkdown(child));
            continue;
          }
          if (tag === 'P') {
            const text = inlineToMarkdown(child).trim();
            if (text) inlineText += (inlineText.trim() ? '\n\n' : '') + text;
            continue;
          }
        }
        inlineText += inlineToMarkdown(child);
      }

      const content = [inlineText.trim()].concat(extras).filter(Boolean).join('\n');
      if (!content) {
        lines.push(indent + marker.trim());
      } else {
        const contentLines = content.split('\n');
        lines.push(indent + marker + contentLines[0]);
        for (let i = 1; i < contentLines.length; i++) {
          lines.push(indent + '  ' + contentLines[i]);
        }
      }

      for (const nested of nestedLists) {
        const nestedMd = listToMarkdown(nested, depth + 1);
        if (nestedMd) lines.push(nestedMd);
      }
    }

    return lines.join('\n');
  }

  /**
   * Recursively walks block-level children, emitting one Markdown block per element.
   * Nested containers are walked rather than selected flatly, so nothing is emitted twice.
   */
  function walkBlocks(node, skipEl) {
    const blocks = [];

    for (const child of node.childNodes) {
      if (child === skipEl) continue;
      if (child.nodeType === Node.TEXT_NODE) {
        const text = (child.textContent || '').replace(/\s+/g, ' ').trim();
        if (text) blocks.push(text);
        continue;
      }
      if (child.nodeType !== Node.ELEMENT_NODE) continue;
      if (shouldSkipElement(child)) continue;

      const tag = child.tagName.toUpperCase();
      if (tag === 'H1' || tag === 'H2' || tag === 'H3' || tag === 'H4') {
        const level = Number(tag[1]);
        const text = inlineToMarkdown(child).replace(/\s+/g, ' ').trim();
        if (text) blocks.push('#'.repeat(level) + ' ' + text);
      } else if (tag === 'P') {
        const text = inlineToMarkdown(child).trim();
        if (text) blocks.push(text);
      } else if (tag === 'PRE') {
        blocks.push(preToMarkdown(child));
      } else if (tag === 'UL' || tag === 'OL') {
        const listMd = listToMarkdown(child, 0);
        if (listMd) blocks.push(listMd);
      } else if (tag === 'BLOCKQUOTE') {
        const quoteMd = blockquoteToMarkdown(child);
        if (quoteMd) blocks.push(quoteMd);
      } else if (tag === 'HR') {
        blocks.push('---');
      } else if (tag === 'IMG') {
        const imgMd = inlineToMarkdown(child);
        if (imgMd) blocks.push(imgMd);
      } else {
        blocks.push(...walkBlocks(child, skipEl));
      }
    }

    return blocks;
  }

  /**
   * Extracts clean markdown from current page DOM if user invokes Copy as Markdown directly on publisher page.
   */
  function extractPageMarkdown() {
    const titleEl = document.querySelector('article h1') || document.querySelector('main h1') || document.querySelector('h1');
    const title = titleEl ? (titleEl.textContent || '').replace(/\s+/g, ' ').trim() : document.title;
    const root = document.querySelector('article') || document.querySelector('main') || document.body;
    if (!root) return null;

    const blocks = [];
    if (title) blocks.push(`# ${title}`);
    blocks.push(...walkBlocks(root, titleEl));

    return blocks.filter(Boolean).join('\n\n');
  }

  /**
   * Creates or updates the Shadow DOM floating pill button.
   */
  function renderFloatingPill(paywallInfo, settings) {
    if (dismissedForUrl === window.location.href) {
      if (pillHost) pillHost.style.display = 'none';
      return;
    }

    if (!settings.showFloatingButton) {
      if (pillHost) pillHost.style.display = 'none';
      return;
    }

    if (!pillHost) {
      pillHost = document.createElement('div');
      pillHost.id = 'freemedium-floating-host';
      const shadow = pillHost.attachShadow({ mode: 'open' });

      const style = document.createElement('style');
      style.textContent = `
        :host {
          all: initial;
          position: fixed;
          bottom: 24px;
          right: 24px;
          z-index: 2147483646;
          font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        }
        .fm-pill-wrap {
          display: flex;
          align-items: center;
          gap: 6px;
          background: rgba(10, 10, 12, 0.92);
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
          border: 1px solid rgba(255, 255, 255, 0.14);
          border-radius: 999px;
          padding: 6px 8px 6px 14px;
          box-shadow: 0 10px 30px rgba(0, 0, 0, 0.45), 0 0 0 1px rgba(16, 185, 129, 0.15);
          color: #ffffff;
          transition: transform 0.2s cubic-bezier(0.16, 1, 0.3, 1), border-color 0.2s ease;
        }
        .fm-pill-wrap:hover {
          transform: translateY(-2px);
          border-color: rgba(16, 185, 129, 0.55);
        }
        .fm-pill-wrap.is-locked {
          border-color: #10b981;
          box-shadow: 0 12px 32px rgba(16, 185, 129, 0.28), 0 0 0 1px rgba(16, 185, 129, 0.4);
        }
        .fm-unlock-btn {
          all: unset;
          display: inline-flex;
          align-items: center;
          gap: 8px;
          cursor: pointer;
          font-size: 13px;
          font-weight: 600;
          letter-spacing: -0.01em;
          color: #ffffff;
          padding: 4px 6px 4px 0;
        }
        .fm-unlock-btn:focus-visible {
          outline: 2px solid #10b981;
          outline-offset: 2px;
          border-radius: 999px;
        }
        .fm-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: #10b981;
          box-shadow: 0 0 8px #10b981;
          flex-shrink: 0;
        }
        .fm-badge {
          font-size: 11px;
          font-weight: 600;
          background: rgba(16, 185, 129, 0.18);
          color: #34d399;
          padding: 2px 7px;
          border-radius: 999px;
          display: none;
        }
        .fm-pill-wrap.is-locked .fm-badge {
          display: inline-block;
        }
        .fm-close-btn {
          all: unset;
          width: 22px;
          height: 22px;
          border-radius: 50%;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          color: #a3a3a3;
          font-size: 12px;
          transition: background 0.15s ease, color 0.15s ease;
        }
        .fm-close-btn:hover {
          background: rgba(255, 255, 255, 0.12);
          color: #ffffff;
        }
        .fm-toast {
          position: fixed;
          bottom: 76px;
          right: 24px;
          background: #10b981;
          color: #050505;
          font-size: 13px;
          font-weight: 600;
          padding: 10px 16px;
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
          .fm-pill-wrap {
            border: 2px solid ButtonText;
          }
        }
      `;

      const wrap = document.createElement('div');
      wrap.className = 'fm-pill-wrap';

      pillButton = document.createElement('button');
      pillButton.className = 'fm-unlock-btn';
      pillButton.title = t('pill.title', null, 'Unlock full article via FreeMedium (Alt+U)');

      const dot = document.createElement('span');
      dot.className = 'fm-dot';

      pillLabel = document.createElement('span');
      pillLabel.textContent = t('pill.unlock', null, 'Unlock with FreeMedium');

      paywallBadge = document.createElement('span');
      paywallBadge.className = 'fm-badge';
      paywallBadge.textContent = t('pill.paywall', null, 'Paywall');

      pillButton.append(dot, pillLabel, paywallBadge);

      pillCloseBtn = document.createElement('button');
      pillCloseBtn.className = 'fm-close-btn';
      pillCloseBtn.title = t('pill.dismiss', null, 'Dismiss for this page');
      pillCloseBtn.textContent = '✕';
      pillCloseBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        dismissedForUrl = window.location.href;
        pillHost.style.display = 'none';
      });

      pillButton.addEventListener('click', () => {
        pillUnlocking = true;
        pillLabel.textContent = t('pill.unlocking', null, 'Unlocking...');
        chrome.runtime.sendMessage({
          type: 'UNLOCK_URL',
          url: window.location.href
        });
      });

      const toast = document.createElement('div');
      toast.className = 'fm-toast';
      toast.id = 'fm-toast';

      wrap.append(pillButton, pillCloseBtn);
      shadow.append(style, wrap, toast);
      document.documentElement.appendChild(pillHost);
    }

    pillHost.style.display = 'block';
    const wrap = pillHost.shadowRoot.querySelector('.fm-pill-wrap');
    if (paywallInfo.locked) {
      wrap.classList.add('is-locked');
      paywallBadge.textContent = paywallInfo.reason || 'Locked';
    } else {
      wrap.classList.remove('is-locked');
    }
  }

  /**
   * Re-applies the localized pill labels without disturbing a pending unlock.
   */
  function refreshPillTexts() {
    if (pillButton) {
      pillButton.title = t('pill.title', null, 'Unlock full article via FreeMedium (Alt+U)');
    }
    if (pillLabel && !pillUnlocking) {
      pillLabel.textContent = t('pill.unlock', null, 'Unlock with FreeMedium');
    }
    if (pillCloseBtn) {
      pillCloseBtn.title = t('pill.dismiss', null, 'Dismiss for this page');
    }
    if (paywallBadge) {
      paywallBadge.textContent = t('pill.paywall', null, 'Paywall');
    }
  }

  function showToast(msg) {
    if (!pillHost || !pillHost.shadowRoot) return;
    const toast = pillHost.shadowRoot.getElementById('fm-toast');
    if (!toast) return;
    toast.textContent = msg;
    toast.classList.add('visible');
    setTimeout(() => toast.classList.remove('visible'), 2400);
  }

  function evaluatePage() {
    const currentUrl = window.location.href;
    if (dismissedForUrl && dismissedForUrl !== currentUrl) dismissedForUrl = '';

    if (!isArticlePage()) {
      if (pillHost) pillHost.style.display = 'none';
      chrome.runtime.sendMessage({ type: 'SET_BADGE', text: '' });
      return;
    }

    const paywall = detectPaywall();

    requestAnimationFrame(() => {
      renderFloatingPill(paywall, cachedSettings);
    });

    if (paywall.locked) {
      chrome.runtime.sendMessage({ type: 'SET_BADGE', text: 'LOCK', color: '#f59e0b' });
      if (cachedSettings.autoUnlockPaywall && autoUnlockTriggeredForUrl !== currentUrl) {
        autoUnlockTriggeredForUrl = currentUrl;
        showToast(t('toast.paywallAuto', null, 'Paywall detected! Auto-unlocking via FreeMedium...'));
        setTimeout(() => {
          chrome.runtime.sendMessage({
            type: 'UNLOCK_URL',
            url: currentUrl,
            sameTab: true
          });
        }, 450);
      }
    } else {
      chrome.runtime.sendMessage({ type: 'SET_BADGE', text: 'FREE', color: '#10b981' });
    }
  }

  /**
   * Fallback clipboard copy for pages where navigator.clipboard is unavailable or rejected.
   */
  function copyTextFallback(text) {
    if (!document.body) return false;
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.top = '-9999px';
    textarea.style.left = '-9999px';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    textarea.setSelectionRange(0, textarea.value.length);
    let copied = false;
    try {
      copied = document.execCommand('copy');
    } catch {
      copied = false;
    }
    textarea.remove();
    return copied;
  }

  // Listen for messages from popup or service worker
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === 'SHOW_TOAST') {
      showToast(message.message || 'Done');
      sendResponse({ ok: true });
      return false;
    }
    if (message.type === 'COPY_MARKDOWN') {
      (async () => {
        const md = extractPageMarkdown();
        if (!md || !md.trim()) {
          showToast(t('toast.noArticleText', null, 'Could not find article text'));
          sendResponse({ ok: false });
          return;
        }
        const fullMd = `${md}\n\n---\n\n${t('md.sourceFooter', { url: window.location.href }, `Source: ${window.location.href}`)}\n`;
        try {
          await navigator.clipboard.writeText(fullMd);
          showToast(t('toast.copied', null, 'Copied article as Markdown!'));
          sendResponse({ ok: true });
        } catch {
          if (copyTextFallback(fullMd)) {
            showToast(t('toast.copied', null, 'Copied article as Markdown!'));
            sendResponse({ ok: true });
          } else {
            sendResponse({ ok: false });
          }
        }
      })();
      return true;
    }
    if (message.type === 'EXTRACT_MARKDOWN') {
      const md = extractPageMarkdown();
      if (!md || !md.trim()) {
        sendResponse({ ok: false, error: 'No article text found' });
        return true;
      }
      sendResponse({
        ok: true,
        markdown: `${md}\n\n---\n\n${t('md.sourceFooter', { url: window.location.href }, `Source: ${window.location.href}`)}\n`
      });
      return true;
    }
    return false;
  });

  /**
   * Coalesces bursts of DOM mutations into at most one evaluation every 250 ms.
   */
  function scheduleEvaluate(delay) {
    if (evaluateTimer !== null) return;
    evaluateTimer = setTimeout(() => {
      evaluateTimer = null;
      i18nReady.then(() => evaluatePage());
    }, delay);
  }

  // Initial check and SPA route observer (Medium navigates client-side).
  // Resolve the language before the pill/badge produce any text.
  i18nReady
    .then(() => chrome.storage.local.get('settings'))
    .then(({ settings }) => {
      cachedSettings = { ...DEFAULT_SETTINGS, ...(settings || {}) };
      setUiLanguage(settings);
    })
    .catch(() => {})
    .finally(() => evaluatePage());
  // Keep the cached settings and the live UI language in sync
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.settings) return;
    const nextSettings = changes.settings.newValue || {};
    cachedSettings = { ...DEFAULT_SETTINGS, ...nextSettings };
    setUiLanguage(nextSettings);
    refreshPillTexts();
    evaluatePage();
  });

  const observer = new MutationObserver(() => {
    if (window.location.href !== lastCheckedUrl) {
      lastCheckedUrl = window.location.href;
      dismissedForUrl = '';
      scheduleEvaluate(600);
    } else {
      scheduleEvaluate(250);
    }
  });

  if (document.documentElement) {
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }
})();
