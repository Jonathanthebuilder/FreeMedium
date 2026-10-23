/**
 * FreeMedium — Publisher Detector & Floating Unlock Pill
 * Runs on Medium (and Medium publications) + NYT, WaPo, Bloomberg, Reuters, Economist, FT.
 * Detects article pages and paywalls, displays a floating Shadow DOM Unlock pill,
 * and triggers automatic unlock when a paywall is hit.
 */

(function () {
  'use strict';

  const NON_ARTICLE_PATHS = new Set([
    '/', '/me', '/new-story', '/plans', '/membership', '/search',
    '/tag', '/topics', '/about', '/jobs', '/creators', '/m/signin'
  ]);

  let pillHost = null;
  let pillButton = null;
  let paywallBadge = null;
  let autoUnlockTriggeredForUrl = '';
  let lastCheckedUrl = '';

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
    if (articleEl && (articleEl.innerText || '').length > 400 && pathname.split('/').filter(Boolean).length >= 1) {
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
      return { locked: true, reason: 'Member-only story' };
    }

    // Check JSON-LD schema for isAccessibleForFree: false
    const ldScripts = document.querySelectorAll('script[type="application/ld+json"]');
    for (const s of ldScripts) {
      const txt = s.textContent || '';
      if (/"isAccessibleForFree"\s*:\s*(false|"False")/i.test(txt)) {
        return { locked: true, reason: 'Subscriber-only article' };
      }
    }

    // Medium DOM paywall markers
    const bodyText = document.body ? document.body.innerText : '';
    if (
      document.querySelector('[data-testid="paywall"], #paywall-background-color') ||
      (bodyText.includes('Member-only story') && (
        bodyText.includes('Become a member to read this story') ||
        bodyText.includes('Read this story from') ||
        bodyText.includes('Create an account to read the full story')
      ))
    ) {
      return { locked: true, reason: 'Member-only story' };
    }

    // Other publishers (NYT, WaPo, FT, Economist, Bloomberg) paywall gates
    if (
      document.querySelector(
        '#gateway-content, [data-testid="paywall-overlay"], .paywall-overlay, .tp-modal, [data-qa="paywall-regwall"]'
      )
    ) {
      return { locked: true, reason: 'Paywall detected' };
    }

    return { locked: false, reason: '' };
  }

  /**
   * Extracts clean markdown from current page DOM if user invokes Copy as Markdown directly on publisher page.
   */
  function extractPageMarkdown() {
    const h1 = document.querySelector('article h1') || document.querySelector('main h1') || document.querySelector('h1');
    const title = h1 ? (h1.textContent || '').replace(/\s+/g, ' ').trim() : document.title;
    const root = document.querySelector('article') || document.querySelector('main') || document.body;
    if (!root) return null;

    const lines = [];
    if (title) lines.push(`# ${title}`);

    const blocks = root.querySelectorAll('h2, h3, h4, p, pre, blockquote, ul, ol');
    for (const el of blocks) {
      const tag = el.tagName.toUpperCase();
      const text = (el.innerText || '').trim();
      if (!text) continue;
      if (tag === 'H2') lines.push(`## ${text}`);
      else if (tag === 'H3') lines.push(`### ${text}`);
      else if (tag === 'H4') lines.push(`#### ${text}`);
      else if (tag === 'PRE') lines.push('```\n' + text + '\n```');
      else if (tag === 'BLOCKQUOTE') lines.push(text.split('\n').map(l => `> ${l}`).join('\n'));
      else lines.push(text);
    }
    return lines.join('\n\n');
  }

  /**
   * Creates or updates the Shadow DOM floating pill button.
   */
  function renderFloatingPill(paywallInfo, settings) {
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
      pillButton.title = 'Unlock full article via FreeMedium (Alt+U)';

      const dot = document.createElement('span');
      dot.className = 'fm-dot';

      const label = document.createElement('span');
      label.textContent = 'Unlock with FreeMedium';

      paywallBadge = document.createElement('span');
      paywallBadge.className = 'fm-badge';
      paywallBadge.textContent = 'Paywall';

      pillButton.append(dot, label, paywallBadge);

      const closeBtn = document.createElement('button');
      closeBtn.className = 'fm-close-btn';
      closeBtn.title = 'Dismiss for this page';
      closeBtn.textContent = '✕';
      closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        pillHost.style.display = 'none';
      });

      pillButton.addEventListener('click', () => {
        label.textContent = 'Unlocking...';
        chrome.runtime.sendMessage({
          type: 'UNLOCK_URL',
          url: window.location.href
        });
      });

      const toast = document.createElement('div');
      toast.className = 'fm-toast';
      toast.id = 'fm-toast';

      wrap.append(pillButton, closeBtn);
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

  function showToast(msg) {
    if (!pillHost || !pillHost.shadowRoot) return;
    const toast = pillHost.shadowRoot.getElementById('fm-toast');
    if (!toast) return;
    toast.textContent = msg;
    toast.classList.add('visible');
    setTimeout(() => toast.classList.remove('visible'), 2400);
  }

  async function evaluatePage() {
    const currentUrl = window.location.href;
    if (!isArticlePage()) {
      if (pillHost) pillHost.style.display = 'none';
      chrome.runtime.sendMessage({ type: 'SET_BADGE', text: '' });
      return;
    }

    const { settings = {} } = await chrome.storage.local.get('settings');
    const mergedSettings = {
      autoUnlockPaywall: true,
      showFloatingButton: true,
      ...settings
    };

    const paywall = detectPaywall();

    requestAnimationFrame(() => {
      renderFloatingPill(paywall, mergedSettings);
    });

    if (paywall.locked) {
      chrome.runtime.sendMessage({ type: 'SET_BADGE', text: 'LOCK', color: '#f59e0b' });
      if (mergedSettings.autoUnlockPaywall && autoUnlockTriggeredForUrl !== currentUrl) {
        autoUnlockTriggeredForUrl = currentUrl;
        showToast('Paywall detected! Auto-unlocking via FreeMedium...');
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
        if (!md) {
          showToast('Could not find article text');
          sendResponse({ ok: false });
          return;
        }
        const fullMd = `${md}\n\n---\n\nSource: ${window.location.href}\n`;
        try {
          await navigator.clipboard.writeText(fullMd);
          showToast('Copied article as Markdown!');
          sendResponse({ ok: true });
        } catch {
          sendResponse({ ok: false });
        }
      })();
      return true;
    }
    return false;
  });

  // Initial check and SPA route observer (Medium navigates client-side)
  evaluatePage();

  const observer = new MutationObserver(() => {
    if (window.location.href !== lastCheckedUrl) {
      lastCheckedUrl = window.location.href;
      setTimeout(evaluatePage, 600);
    } else if (isArticlePage() && autoUnlockTriggeredForUrl !== window.location.href) {
      const pw = detectPaywall();
      if (pw.locked) evaluatePage();
    }
  });

  if (document.documentElement) {
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }
})();
