(() => {
  'use strict';

  const STYLE_ELEMENT_ID = 'word-blocker-styles';
  const BLOCK_STATE_ATTRIBUTE = 'data-word-blocker-state';
  const MATCHED_WORD_ATTRIBUTE = 'data-word-blocker-match';

  const VIDEO_CONTAINER_SELECTORS = [
    'ytd-rich-item-renderer',
    'ytd-video-renderer',
    'ytd-grid-video-renderer',
    'ytd-compact-video-renderer',
    'ytd-playlist-video-renderer',
    'ytd-playlist-panel-video-renderer',
    'ytd-reel-item-renderer',
    'ytd-compact-playlist-renderer'
  ];
  const VIDEO_CONTAINER_SELECTOR = VIDEO_CONTAINER_SELECTORS.join(',');

  const RESCAN_DEBOUNCE_MS = 150;
  const PERSIST_DEBOUNCE_MS = 200;

  let blockedWords = [];
  let displayMode = 'blur';
  let blockedCount = 0;
  let rescanQueued = false;
  let persistCountTimer = null;

  function normalizeWords(rawWords) {
    if (!Array.isArray(rawWords)) return [];
    return rawWords
      .map((word) => String(word).trim().toLowerCase())
      .filter((word) => word.length > 0);
  }

  function normalizeDisplayMode(rawDisplayMode) {
    return rawDisplayMode === 'hide' ? 'hide' : 'blur';
  }

  function loadSettingsAndStart() {
    chrome.storage.sync.get(['blockedWords', 'displayMode'], (settings) => {
      blockedWords = normalizeWords(settings.blockedWords);
      displayMode = normalizeDisplayMode(settings.displayMode);
      startObservingPageChanges();
      scheduleRescan();
    });
  }

  function handleStorageChange(changes, areaName) {
    if (areaName !== 'sync') return;

    let needsRescan = false;

    if (changes.blockedWords) {
      blockedWords = normalizeWords(changes.blockedWords.newValue);
      needsRescan = true;
    }

    if (changes.displayMode) {
      displayMode = normalizeDisplayMode(changes.displayMode.newValue);
      needsRescan = true;
    }

    if (needsRescan) {
      resetAllBlockedContainers();
      scheduleRescan();
    }
  }

  function startObservingPageChanges() {
    const observer = new MutationObserver((mutations) => {
      const hasAddedNodes = mutations.some(
        (mutation) => mutation.addedNodes && mutation.addedNodes.length > 0
      );
      if (hasAddedNodes) scheduleRescan();
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true
    });

    document.addEventListener('yt-navigate-finish', () => {
      resetAllBlockedContainers();
      scheduleRescan();
    });
  }

  function scheduleRescan() {
    if (rescanQueued) return;
    rescanQueued = true;
    setTimeout(() => {
      rescanQueued = false;
      scanVisibleVideos();
    }, RESCAN_DEBOUNCE_MS);
  }

  function scanVisibleVideos() {
    if (blockedWords.length === 0) {
      resetAllBlockedContainers();
      return;
    }
    document.querySelectorAll(VIDEO_CONTAINER_SELECTOR).forEach(processContainer);
    schedulePersistBlockedCount();
  }

  function processContainer(container) {
    const containerText = getContainerText(container);
    const matchedWord = findMatchingWord(containerText);
    const wasBlocked = container.getAttribute(BLOCK_STATE_ATTRIBUTE) === 'blocked';

    if (matchedWord) {
      if (!wasBlocked) blockedCount++;
      applyBlock(container, matchedWord);
    } else if (wasBlocked) {
      blockedCount = Math.max(0, blockedCount - 1);
      clearBlock(container);
    }
  }

  function getContainerText(container) {
    const titleElement =
      container.querySelector('#video-title') ||
      container.querySelector('a#video-title-link') ||
      container.querySelector('h3 a');
    const titleText =
      (titleElement && (titleElement.getAttribute('title') || titleElement.textContent)) || '';

    const descriptionElement =
      container.querySelector('#description-text') ||
      container.querySelector('.metadata-snippet-text') ||
      container.querySelector('yt-formatted-string.metadata-snippet-text');
    const descriptionText = (descriptionElement && descriptionElement.textContent) || '';

    return `${titleText} ${descriptionText}`.toLowerCase();
  }

  function findMatchingWord(lowerCaseText) {
    return blockedWords.find((word) => lowerCaseText.includes(word)) || null;
  }

  function applyBlock(container, matchedWord) {
    container.setAttribute(BLOCK_STATE_ATTRIBUTE, 'blocked');
    container.setAttribute(MATCHED_WORD_ATTRIBUTE, matchedWord);
    container.title = `Blocked by Word Blocker: matched "${matchedWord}"`;

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
    container.removeAttribute(BLOCK_STATE_ATTRIBUTE);
    container.removeAttribute(MATCHED_WORD_ATTRIBUTE);
    container.removeAttribute('title');
    container.classList.remove('word-blocker-hidden', 'word-blocker-blur');
    removeOverlay(container);
  }

  function resetAllBlockedContainers() {
    document.querySelectorAll(`[${BLOCK_STATE_ATTRIBUTE}]`).forEach(clearBlock);
    blockedCount = 0;
    schedulePersistBlockedCount();
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

  function schedulePersistBlockedCount() {
    clearTimeout(persistCountTimer);
    persistCountTimer = setTimeout(() => {
      chrome.storage.local.set({ blockedCount });
    }, PERSIST_DEBOUNCE_MS);
  }

  function injectStyles() {
    if (document.getElementById(STYLE_ELEMENT_ID)) return;

    const styleElement = document.createElement('style');
    styleElement.id = STYLE_ELEMENT_ID;
    styleElement.textContent = `
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
    document.documentElement.appendChild(styleElement);
  }

  chrome.storage.onChanged.addListener(handleStorageChange);

  injectStyles();
  loadSettingsAndStart();
})();
