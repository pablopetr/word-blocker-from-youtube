// content.js
//
// Runs on every youtube.com page. Scans the video "cards" YouTube renders
// (home grid, search results, channel pages, watch-page sidebar, playlists,
// shorts shelf, ...), compares each card's title + description snippet
// against the user's blocked-word list, and hides or blurs matches.
//
// Two things keep this in sync with a page that never stops changing:
//   1. A MutationObserver watches for new cards inserted by YouTube's
//      infinite-scroll / lazy-loading as the user scrolls.
//   2. A chrome.storage.onChanged listener re-scans everything the moment
//      the user edits their word list or display mode in the popup, with
//      no page reload required.

(() => {
  'use strict';

  const STYLE_ID = 'word-blocker-styles';
  const STATE_ATTR = 'data-word-blocker-state'; // "blocked" while hidden/blurred
  const MATCH_ATTR = 'data-word-blocker-match'; // which word triggered the block

  // Every shape of "video card" YouTube currently renders. querySelectorAll
  // with this combined selector covers home, search, channel, watch-page
  // recommendations, playlists and shorts shelves.
  const VIDEO_SELECTORS = [
    'ytd-rich-item-renderer', // Home page grid
    'ytd-video-renderer', // Search results
    'ytd-grid-video-renderer', // Channel "Videos" tab (grid layout)
    'ytd-compact-video-renderer', // Watch page "Up next" sidebar
    'ytd-playlist-video-renderer', // Inside a playlist
    'ytd-playlist-panel-video-renderer', // Playlist panel on watch page
    'ytd-reel-item-renderer', // Shorts shelf
    'ytd-compact-playlist-renderer'
  ];
  const VIDEO_SELECTOR = VIDEO_SELECTORS.join(',');

  let blockedWords = []; // normalized: lower-cased, trimmed, non-empty
  let displayMode = 'blur'; // 'blur' | 'hide'
  let blockedCount = 0;
  let rescanQueued = false;

  injectStyles();
  loadSettingsAndStart();

  // ---------------------------------------------------------------------
  // Settings: load once, then react to live changes from the popup.
  // ---------------------------------------------------------------------

  function loadSettingsAndStart() {
    chrome.storage.sync.get(['blockedWords', 'displayMode'], (data) => {
      blockedWords = normalizeWords(data.blockedWords);
      displayMode = data.displayMode === 'hide' ? 'hide' : 'blur';
      startObserving();
      scheduleRescan();
    });
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;

    let needsRescan = false;
    if (changes.blockedWords) {
      blockedWords = normalizeWords(changes.blockedWords.newValue);
      needsRescan = true;
    }
    if (changes.displayMode) {
      displayMode = changes.displayMode.newValue === 'hide' ? 'hide' : 'blur';
      needsRescan = true;
    }

    if (needsRescan) {
      // Clear every existing block first so cards that no longer match
      // (or need the other display mode) are restored before re-scanning.
      resetAllContainers();
      scheduleRescan();
    }
  });

  function normalizeWords(raw) {
    if (!Array.isArray(raw)) return [];
    return raw
      .map((word) => String(word).trim().toLowerCase())
      .filter((word) => word.length > 0);
  }

  // ---------------------------------------------------------------------
  // Watching the page for lazy-loaded / newly rendered videos.
  // ---------------------------------------------------------------------

  function startObserving() {
    const observer = new MutationObserver((mutations) => {
      const hasAddedNodes = mutations.some((m) => m.addedNodes && m.addedNodes.length > 0);
      if (hasAddedNodes) scheduleRescan();
    });

    observer.observe(document.documentElement, { childList: true, subtree: true });

    // YouTube is a single-page app: navigating between videos/pages doesn't
    // reload the document, so listen for its internal navigation event too.
    document.addEventListener('yt-navigate-finish', () => {
      resetAllContainers();
      scheduleRescan();
    });
  }

  // Debounce rescans so fast scrolling / bulk DOM insertions don't trigger
  // a full re-scan on every single mutation record.
  function scheduleRescan() {
    if (rescanQueued) return;
    rescanQueued = true;
    setTimeout(() => {
      rescanQueued = false;
      scanVisibleVideos();
    }, 150);
  }

  function scanVisibleVideos() {
    if (blockedWords.length === 0) {
      resetAllContainers();
      return;
    }
    document.querySelectorAll(VIDEO_SELECTOR).forEach(processContainer);
    persistBlockedCount();
  }

  // ---------------------------------------------------------------------
  // Per-card matching logic.
  // ---------------------------------------------------------------------

  function processContainer(container) {
    const text = getContainerText(container);
    const match = findMatch(text);
    const wasBlocked = container.getAttribute(STATE_ATTR) === 'blocked';

    if (match) {
      if (!wasBlocked) blockedCount++;
      applyBlock(container, match);
    } else if (wasBlocked) {
      blockedCount = Math.max(0, blockedCount - 1);
      clearBlock(container);
    }
  }

  function getContainerText(container) {
    const titleEl =
      container.querySelector('#video-title') ||
      container.querySelector('a#video-title-link') ||
      container.querySelector('h3 a');
    const title = (titleEl && (titleEl.getAttribute('title') || titleEl.textContent)) || '';

    const descEl =
      container.querySelector('#description-text') ||
      container.querySelector('.metadata-snippet-text') ||
      container.querySelector('yt-formatted-string.metadata-snippet-text');
    const description = (descEl && descEl.textContent) || '';

    return `${title} ${description}`.toLowerCase();
  }

  function findMatch(lowerCaseText) {
    return blockedWords.find((word) => lowerCaseText.includes(word)) || null;
  }

  // ---------------------------------------------------------------------
  // Applying / removing the hide-or-blur treatment.
  // ---------------------------------------------------------------------

  function applyBlock(container, matchedWord) {
    container.setAttribute(STATE_ATTR, 'blocked');
    container.setAttribute(MATCH_ATTR, matchedWord);
    container.title = `Blocked by Word Blocker: matched "${matchedWord}"`;
    console.debug(`[Word Blocker] Blocked video (matched "${matchedWord}")`, container);

    if (displayMode === 'hide') {
      container.classList.remove('word-blocker-blur');
      removeOverlay(container);
      container.classList.add('word-blocker-hidden');
    } else {
      container.classList.remove('word-blocker-hidden');
      container.classList.add('word-blocker-blur');
      addOverlay(container, matchedWord);
    }
  }

  function clearBlock(container) {
    container.removeAttribute(STATE_ATTR);
    container.removeAttribute(MATCH_ATTR);
    container.removeAttribute('title');
    container.classList.remove('word-blocker-hidden', 'word-blocker-blur');
    removeOverlay(container);
  }

  function resetAllContainers() {
    document.querySelectorAll(`[${STATE_ATTR}]`).forEach(clearBlock);
    blockedCount = 0;
    persistBlockedCount();
  }

  function addOverlay(container, matchedWord) {
    if (container.querySelector(':scope > .word-blocker-overlay')) return;
    if (getComputedStyle(container).position === 'static') {
      container.style.position = 'relative';
    }
    const overlay = document.createElement('div');
    overlay.className = 'word-blocker-overlay';
    overlay.textContent = `Blocked (matched: "${matchedWord}")`;
    overlay.title = `This video was blurred because its title/description matched "${matchedWord}"`;
    container.appendChild(overlay);
  }

  function removeOverlay(container) {
    const overlay = container.querySelector(':scope > .word-blocker-overlay');
    if (overlay) overlay.remove();
  }

  // ---------------------------------------------------------------------
  // Persist the live blocked-video count so the popup can display it.
  // ---------------------------------------------------------------------

  let persistTimer = null;
  function persistBlockedCount() {
    clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
      chrome.storage.local.set({ blockedCount });
    }, 200);
  }

  // ---------------------------------------------------------------------
  // Inject the CSS used for the blur + overlay / hide treatments.
  // ---------------------------------------------------------------------

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .word-blocker-hidden {
        display: none !important;
      }
      .word-blocker-blur {
        position: relative;
      }
      .word-blocker-blur #thumbnail,
      .word-blocker-blur ytd-thumbnail,
      .word-blocker-blur img {
        filter: blur(18px);
        transition: filter 0.15s ease;
      }
      .word-blocker-blur:hover #thumbnail,
      .word-blocker-blur:hover ytd-thumbnail,
      .word-blocker-blur:hover img {
        filter: blur(4px);
      }
      .word-blocker-overlay {
        position: absolute;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        text-align: center;
        padding: 8px;
        background: rgba(0, 0, 0, 0.55);
        color: #fff;
        font-size: 13px;
        font-weight: 600;
        line-height: 1.3;
        z-index: 10;
        pointer-events: none;
        border-radius: 8px;
      }
    `;
    document.documentElement.appendChild(style);
  }
})();
