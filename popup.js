// popup.js
//
// Handles the popup UI: loading/saving the blocked-word list and display
// mode to chrome.storage.sync, showing the live blocked-video count from
// chrome.storage.local (written by content.js), and import/export of the
// word list as a plain-text file.

document.addEventListener('DOMContentLoaded', init);

const wordsInput = document.getElementById('wordsInput');
const saveBtn = document.getElementById('saveBtn');
const clearBtn = document.getElementById('clearBtn');
const exportBtn = document.getElementById('exportBtn');
const importBtn = document.getElementById('importBtn');
const importFile = document.getElementById('importFile');
const statusMsg = document.getElementById('statusMsg');
const blockedCountEl = document.getElementById('blockedCount');
const modeRadios = document.querySelectorAll('input[name="displayMode"]');

let statusTimer = null;

function init() {
  loadSavedWords();
  loadBlockedCount();

  saveBtn.addEventListener('click', handleSave);
  clearBtn.addEventListener('click', handleClearAll);
  exportBtn.addEventListener('click', handleExport);
  importBtn.addEventListener('click', () => importFile.click());
  importFile.addEventListener('change', handleImport);

  // Keep the counter live if the popup is left open while browsing.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.blockedCount) {
      blockedCountEl.textContent = changes.blockedCount.newValue || 0;
    }
  });
}

// ---------------------------------------------------------------------
// Loading existing settings
// ---------------------------------------------------------------------

function loadSavedWords() {
  chrome.storage.sync.get(['blockedWords', 'displayMode'], (data) => {
    const words = Array.isArray(data.blockedWords) ? data.blockedWords : [];
    wordsInput.value = words.join('\n');

    const mode = data.displayMode === 'hide' ? 'hide' : 'blur';
    modeRadios.forEach((radio) => {
      radio.checked = radio.value === mode;
    });
  });
}

function loadBlockedCount() {
  chrome.storage.local.get(['blockedCount'], (data) => {
    blockedCountEl.textContent = data.blockedCount || 0;
  });
}

// ---------------------------------------------------------------------
// Parsing helpers
// ---------------------------------------------------------------------

function parseWordsFromTextarea() {
  return wordsInput.value
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .filter((line, index, all) => all.indexOf(line) === index); // dedupe
}

function getSelectedMode() {
  const checked = document.querySelector('input[name="displayMode"]:checked');
  return checked ? checked.value : 'blur';
}

// ---------------------------------------------------------------------
// Button handlers
// ---------------------------------------------------------------------

function handleSave() {
  const words = parseWordsFromTextarea();
  const displayMode = getSelectedMode();

  chrome.storage.sync.set({ blockedWords: words, displayMode }, () => {
    if (chrome.runtime.lastError) {
      showStatus(`Error saving: ${chrome.runtime.lastError.message}`, true);
      return;
    }
    wordsInput.value = words.join('\n');
    showStatus(
      words.length > 0
        ? `Saved! Now blocking ${words.length} word${words.length === 1 ? '' : 's'}.`
        : 'Saved. No words are currently blocked.'
    );
  });
}

function handleClearAll() {
  if (!confirm('Clear your entire blocked-words list?')) return;

  chrome.storage.sync.set({ blockedWords: [] }, () => {
    if (chrome.runtime.lastError) {
      showStatus(`Error clearing: ${chrome.runtime.lastError.message}`, true);
      return;
    }
    wordsInput.value = '';
    showStatus('Blocked words list cleared.');
  });
}

function handleExport() {
  const words = parseWordsFromTextarea();
  const blob = new Blob([words.join('\n')], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = 'blocked-words.txt';
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);

  showStatus(`Exported ${words.length} word${words.length === 1 ? '' : 's'}.`);
}

function handleImport(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = () => {
    const importedWords = String(reader.result)
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    const existingWords = parseWordsFromTextarea();
    const merged = [...existingWords, ...importedWords].filter(
      (word, index, all) => all.indexOf(word) === index
    );

    wordsInput.value = merged.join('\n');
    showStatus(`Imported ${importedWords.length} word(s). Click "Save Words" to apply.`);
  };
  reader.onerror = () => showStatus('Could not read that file.', true);
  reader.readAsText(file);

  // Reset so importing the same file again still fires the change event.
  importFile.value = '';
}

// ---------------------------------------------------------------------
// Status message helper
// ---------------------------------------------------------------------

function showStatus(message, isError = false) {
  clearTimeout(statusTimer);
  statusMsg.textContent = message;
  statusMsg.classList.toggle('error', isError);
  statusTimer = setTimeout(() => {
    statusMsg.textContent = '';
    statusMsg.classList.remove('error');
  }, 4000);
}
