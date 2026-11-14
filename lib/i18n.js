/**
 * FreeMedium — Tiny i18n layer (English / Simplified Chinese)
 * Loaded by the popup, both content scripts, and the service worker.
 * The active language comes from settings.language: 'auto' | 'en' | 'zh_CN'.
 */

(function (global) {
  'use strict';

  const MESSAGES = {
    en: {
      // Popup shell
      'app.subtitle': 'Ad-Free Paywall Unlocker',
      'status.ready': 'Ready',
      'status.readingMirror': 'Reading on Mirror',
      'status.readyToUnlock': 'Ready to Unlock',
      'currentTab.label': 'Current Tab',
      'currentTab.detecting': 'Detecting...',
      'currentTab.system': 'System / Empty Tab',
      'currentTab.webPage': 'Web Page',
      'unlock.current': 'Unlock Current Tab',
      'unlock.nextMirror': 'Switch to Next Mirror',
      'copy.markdown': 'Markdown',
      'copy.title': 'Copy article as Markdown (Alt+M)',
      'bookmark.save': 'Save to bookmarks',
      'mirror.label': 'Active Mirror',
      'mirror.freediumMirror': 'Freedium Mirror (freedium-mirror.cfd)',
      'mirror.freedium': 'Freedium (freedium.cfd)',
      'mirror.freediumWeb': 'Freedium Web (Vercel)',
      'mirror.archiveNewest': 'Archive.is (Newest)',
      'mirror.archiveOldest': 'Archive.is (Oldest)',
      'url.placeholder': 'Or paste any article URL to unlock...',
      'url.go': 'Go',

      // Settings
      'settings.title': 'Smart Automation & Purification',
      'toggle.autoUnlock.name': 'Auto-Unlock on Paywall',
      'toggle.autoUnlock.desc': 'Automatically redirect when a locked story is detected',
      'toggle.floating.name': 'Floating Unlock Pill',
      'toggle.floating.desc': 'Show a 1-click unlock button on Medium & 6 publishers',
      'toggle.fallback.name': 'Auto-Fallback Mirror',
      'toggle.fallback.desc': 'Switch mirror automatically if the current one fails or times out',
      'toggle.purify.name': 'Purify Mirror Popups & Ads',
      'toggle.purify.desc': 'Hide donation banners, announcement toasts and support modals on mirrors',
      'toggle.language.name': 'Language',
      'toggle.language.desc': 'Language used for the popup and on-page buttons',
      'toggle.newTab.name': 'Open Unlocked in New Tab',
      'toggle.newTab.desc': 'Keep the original article tab open when unlocking',
      'language.auto': 'Auto (browser)',
      'language.en': 'English',
      'language.zh': '简体中文',

      // Library
      'tab.recent': 'Recent',
      'tab.saved': 'Saved ★',
      'clear.label': 'Clear',
      'clear.title': 'Clear current list',
      'empty.recent': 'No unlocked articles yet.',
      'empty.saved': 'No saved bookmarks yet.',
      'library.bookmark': 'Bookmark',
      'library.removeBookmark': 'Remove bookmark',
      'library.removeItem': 'Remove item',

      // Popup toasts
      'toast.settingsSaved': 'Settings saved',
      'toast.copied': 'Copied article as Markdown!',
      'toast.copyFailed': 'Clipboard write failed',
      'toast.extractFailTab': 'Could not extract article text from this tab',
      'toast.cannotExtract': 'Cannot extract Markdown on this tab',
      'toast.pastePrompt': 'Paste a URL or type one',
      'toast.invalidUrl': 'Enter a valid http/https article URL',
      'toast.clearedRecent': 'Cleared recent history',
      'toast.clearedSaved': 'Cleared saved bookmarks',
      'toast.bookmarkSaved': 'Saved to bookmarks',
      'toast.bookmarkRemoved': 'Removed from bookmarks',

      // Floating pill
      'pill.unlock': 'Unlock with FreeMedium',
      'pill.unlocking': 'Unlocking...',
      'pill.title': 'Unlock full article via FreeMedium (Alt+U)',
      'pill.paywall': 'Paywall',
      'pill.dismiss': 'Dismiss for this page',
      'paywall.memberOnly': 'Member-only story',
      'paywall.subscriberOnly': 'Subscriber-only article',
      'paywall.detected': 'Paywall detected',
      'toast.paywallAuto': 'Paywall detected! Auto-unlocking via FreeMedium...',
      'toast.noArticleText': 'Could not find article text',

      // Mirror toolbar
      'toolbar.copy': 'Copy Markdown',
      'toolbar.copyTitle': 'Copy full article as Markdown (Alt+M)',
      'toolbar.save': '☆ Save',
      'toolbar.saved': '★ Saved',
      'toolbar.saveTitle': 'Save article to FreeMedium Bookmarks',
      'toolbar.next': '↻ Next Mirror',
      'toolbar.nextTitle': 'Current mirror slow or broken? Switch to next mirror',
      'toolbar.original': '↗ Original',
      'toolbar.originalTitle': 'Open original publisher URL in new tab',
      'toolbar.hideTitle': 'Hide toolbar',
      'toast.switching': 'Switching to next mirror...',
      'toast.extractFail': 'Could not extract article text',

      // Service worker
      'menu.unlockPage': 'Unlock this page with FreeMedium',
      'menu.unlockLink': 'Unlock link with FreeMedium',
      'menu.copyMarkdown': 'Copy article as Markdown',
      'toast.unlocking': 'Unlocking article via FreeMedium...',
      'toast.openingLink': 'Opening unlocked link in new tab...',

      // Markdown export
      'md.sourceFooter': 'Source: {url}'
    },

    zh_CN: {
      // Popup shell
      'app.subtitle': '无广告付费墙解锁器',
      'status.ready': '就绪',
      'status.readingMirror': '镜像阅读中',
      'status.readyToUnlock': '可解锁',
      'currentTab.label': '当前标签页',
      'currentTab.detecting': '检测中…',
      'currentTab.system': '系统页 / 空白页',
      'currentTab.webPage': '网页',
      'unlock.current': '解锁当前标签页',
      'unlock.nextMirror': '切换到下一个镜像',
      'copy.markdown': 'Markdown',
      'copy.title': '将文章复制为 Markdown（Alt+M）',
      'bookmark.save': '收藏到书签',
      'mirror.label': '当前镜像',
      'mirror.freediumMirror': 'Freedium 镜像站（freedium-mirror.cfd）',
      'mirror.freedium': 'Freedium（freedium.cfd）',
      'mirror.freediumWeb': 'Freedium Web（Vercel）',
      'mirror.archiveNewest': 'Archive.is（最新快照）',
      'mirror.archiveOldest': 'Archive.is（最早快照）',
      'url.placeholder': '或粘贴任意文章链接进行解锁…',
      'url.go': '前往',

      // Settings
      'settings.title': '智能自动化与净化',
      'toggle.autoUnlock.name': '检测到付费墙时自动解锁',
      'toggle.autoUnlock.desc': '检测到会员文章时自动跳转到镜像站',
      'toggle.floating.name': '悬浮解锁按钮',
      'toggle.floating.desc': '在 Medium 及 6 家媒体网站上显示一键解锁按钮',
      'toggle.fallback.name': '镜像自动故障切换',
      'toggle.fallback.desc': '当前镜像失效或超时时自动切换镜像',
      'toggle.purify.name': '净化镜像站弹窗与广告',
      'toggle.purify.desc': '隐藏镜像站的打赏横幅、公告弹窗与打赏模态框',
      'toggle.language.name': '语言',
      'toggle.language.desc': '弹窗与页面按钮使用的语言',
      'toggle.newTab.name': '在新标签页中打开解锁页',
      'toggle.newTab.desc': '解锁时保留原文标签页',
      'language.auto': '跟随浏览器',
      'language.en': 'English',
      'language.zh': '简体中文',

      // Library
      'tab.recent': '最近',
      'tab.saved': '收藏 ★',
      'clear.label': '清空',
      'clear.title': '清空当前列表',
      'empty.recent': '还没有解锁记录。',
      'empty.saved': '还没有收藏。',
      'library.bookmark': '收藏',
      'library.removeBookmark': '取消收藏',
      'library.removeItem': '移除条目',

      // Popup toasts
      'toast.settingsSaved': '设置已保存',
      'toast.copied': '已复制为 Markdown！',
      'toast.copyFailed': '写入剪贴板失败',
      'toast.extractFailTab': '无法从当前标签页提取文章正文',
      'toast.cannotExtract': '当前标签页无法提取 Markdown',
      'toast.pastePrompt': '请粘贴或输入文章链接',
      'toast.invalidUrl': '请输入有效的 http/https 文章链接',
      'toast.clearedRecent': '已清空最近记录',
      'toast.clearedSaved': '已清空收藏',
      'toast.bookmarkSaved': '已加入收藏',
      'toast.bookmarkRemoved': '已取消收藏',

      // Floating pill
      'pill.unlock': '用 FreeMedium 解锁',
      'pill.unlocking': '正在解锁…',
      'pill.title': '通过 FreeMedium 解锁全文（Alt+U）',
      'pill.paywall': '付费墙',
      'pill.dismiss': '在本页隐藏',
      'paywall.memberOnly': '会员专属文章',
      'paywall.subscriberOnly': '订阅者专属文章',
      'paywall.detected': '检测到付费墙',
      'toast.paywallAuto': '检测到付费墙，正在通过 FreeMedium 自动解锁…',
      'toast.noArticleText': '未找到文章正文',

      // Mirror toolbar
      'toolbar.copy': '复制 Markdown',
      'toolbar.copyTitle': '将全文复制为 Markdown（Alt+M）',
      'toolbar.save': '☆ 收藏',
      'toolbar.saved': '★ 已收藏',
      'toolbar.saveTitle': '收藏到 FreeMedium 书签',
      'toolbar.next': '↻ 下一个镜像',
      'toolbar.nextTitle': '当前镜像缓慢或失效？切换到下一个镜像',
      'toolbar.original': '↗ 原文',
      'toolbar.originalTitle': '在新标签页打开原文链接',
      'toolbar.hideTitle': '隐藏工具栏',
      'toast.switching': '正在切换到下一个镜像…',
      'toast.extractFail': '无法提取文章正文',

      // Service worker
      'menu.unlockPage': '用 FreeMedium 解锁此页面',
      'menu.unlockLink': '用 FreeMedium 解锁此链接',
      'menu.copyMarkdown': '将文章复制为 Markdown',
      'toast.unlocking': '正在通过 FreeMedium 解锁文章…',
      'toast.openingLink': '正在新标签页中打开解锁链接…',

      // Markdown export
      'md.sourceFooter': '来源：{url}'
    }
  };

  const SUPPORTED_SETTINGS = ['auto', 'en', 'zh_CN'];
  let currentLanguage = 'en';

  function normalizeSetting(value) {
    if (value === 'zh' || value === 'zh-CN' || value === 'zh_CN') return 'zh_CN';
    if (value === 'en') return 'en';
    return 'auto';
  }

  function browserLanguage() {
    let ui = '';
    try {
      if (typeof chrome !== 'undefined' && chrome.i18n && chrome.i18n.getUILanguage) {
        ui = chrome.i18n.getUILanguage() || '';
      }
    } catch {
      // ignore
    }
    if (!ui) {
      try {
        ui = (typeof navigator !== 'undefined' && navigator.language) || 'en';
      } catch {
        ui = 'en';
      }
    }
    return String(ui).toLowerCase().startsWith('zh') ? 'zh_CN' : 'en';
  }

  function resolveLanguage(setting) {
    const normalized = normalizeSetting(setting);
    return normalized === 'auto' ? browserLanguage() : normalized;
  }

  function setLanguage(setting) {
    currentLanguage = resolveLanguage(setting);
    return currentLanguage;
  }

  function getLanguage() {
    return currentLanguage;
  }

  function t(key, params) {
    const dict = MESSAGES[currentLanguage] || MESSAGES.en;
    let value = dict[key];
    if (value === undefined) value = MESSAGES.en[key];
    if (value === undefined) return key;
    if (!params) return value;
    return value.replace(/\{(\w+)\}/g, (match, name) => (
      params[name] === undefined || params[name] === null ? match : String(params[name])
    ));
  }

  /**
   * Translates elements carrying data-i18n / data-i18n-title /
   * data-i18n-placeholder / data-i18n-aria-label inside `root`.
   */
  function apply(root) {
    const scope = root || (typeof document !== 'undefined' ? document : null);
    if (!scope || !scope.querySelectorAll) return;
    scope.querySelectorAll('[data-i18n]').forEach((node) => {
      node.textContent = t(node.getAttribute('data-i18n'));
    });
    scope.querySelectorAll('[data-i18n-title]').forEach((node) => {
      node.title = t(node.getAttribute('data-i18n-title'));
    });
    scope.querySelectorAll('[data-i18n-placeholder]').forEach((node) => {
      node.placeholder = t(node.getAttribute('data-i18n-placeholder'));
    });
    scope.querySelectorAll('[data-i18n-aria-label]').forEach((node) => {
      node.setAttribute('aria-label', t(node.getAttribute('data-i18n-aria-label')));
    });
    if (typeof document !== 'undefined' && document.documentElement) {
      document.documentElement.lang = currentLanguage === 'zh_CN' ? 'zh-CN' : 'en';
    }
  }

  /**
   * Reads settings.language from chrome.storage and applies it.
   * Safe to call from the popup, content scripts, and the service worker.
   */
  function initFromStorage() {
    let pending;
    try {
      pending = chrome.storage.local.get('settings');
    } catch {
      return Promise.resolve(setLanguage('auto'));
    }
    return Promise.resolve(pending)
      .then(({ settings } = {}) => setLanguage(settings && settings.language))
      .catch(() => setLanguage('auto'));
  }

  global.FM_I18N = {
    SUPPORTED_SETTINGS,
    normalizeSetting,
    resolveLanguage,
    setLanguage,
    getLanguage,
    t,
    apply,
    initFromStorage
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
