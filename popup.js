const STATUS_MESSAGE_DURATION_MS = 4000;

document.addEventListener('DOMContentLoaded', initializePopup);

const blockedWordsTextarea = document.getElementById('wordsInput');
const saveButton = document.getElementById('saveButton');
const clearButton = document.getElementById('clearButton');
const exportButton = document.getElementById('exportButton');
const importButton = document.getElementById('importButton');
const importFileInput = document.getElementById('importFileInput');
const statusMessageElement = document.getElementById('statusMessage');
const blockedCountElement = document.getElementById('blockedCount');
const displayModeRadioButtons = document.querySelectorAll('input[name="displayMode"]');

let statusMessageTimer = null;

function initializePopup() {
  loadSavedWords();
  loadBlockedCount();

  saveButton.addEventListener('click', handleSave);
  clearButton.addEventListener('click', handleClearAll);
  exportButton.addEventListener('click', handleExport);
  importButton.addEventListener('click', () => importFileInput.click());
  importFileInput.addEventListener('change', handleImport);

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local' && changes.blockedCount) {
      blockedCountElement.textContent = changes.blockedCount.newValue || 0;
    }
  });
}

function loadSavedWords() {
  chrome.storage.sync.get(['blockedWords', 'displayMode'], (settings) => {
    const words = Array.isArray(settings.blockedWords) ? settings.blockedWords : [];
    blockedWordsTextarea.value = words.join('\n');

    const displayMode = settings.displayMode === 'hide' ? 'hide' : 'blur';
    displayModeRadioButtons.forEach((radioButton) => {
      radioButton.checked = radioButton.value === displayMode;
    });
  });
}

function loadBlockedCount() {
  chrome.storage.local.get(['blockedCount'], (settings) => {
    blockedCountElement.textContent = settings.blockedCount || 0;
  });
}

function removeDuplicates(words) {
  return words.filter((word, index) => words.indexOf(word) === index);
}

function parseWordsFromTextarea() {
  const lines = blockedWordsTextarea.value
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  return removeDuplicates(lines);
}

function getSelectedDisplayMode() {
  const checkedRadioButton = document.querySelector('input[name="displayMode"]:checked');
  return checkedRadioButton ? checkedRadioButton.value : 'blur';
}

function pluralize(count, singularWord, pluralWord) {
  return count === 1 ? singularWord : pluralWord;
}

function handleSave() {
  const words = parseWordsFromTextarea();
  const displayMode = getSelectedDisplayMode();

  chrome.storage.sync.set({ blockedWords: words, displayMode }, () => {
    if (chrome.runtime.lastError) {
      showStatusMessage(`Error saving: ${chrome.runtime.lastError.message}`, true);
      return;
    }

    blockedWordsTextarea.value = words.join('\n');

    const savedMessage =
      words.length > 0
        ? `Saved! Now blocking ${words.length} ${pluralize(words.length, 'word', 'words')}.`
        : 'Saved. No words are currently blocked.';
    showStatusMessage(savedMessage);
  });
}

function handleClearAll() {
  const userConfirmedClear = confirm('Clear your entire blocked-words list?');
  if (!userConfirmedClear) return;

  chrome.storage.sync.set({ blockedWords: [] }, () => {
    if (chrome.runtime.lastError) {
      showStatusMessage(`Error clearing: ${chrome.runtime.lastError.message}`, true);
      return;
    }

    blockedWordsTextarea.value = '';
    showStatusMessage('Blocked words list cleared.');
  });
}

function handleExport() {
  const words = parseWordsFromTextarea();
  const fileBlob = new Blob([words.join('\n')], { type: 'text/plain' });
  const fileUrl = URL.createObjectURL(fileBlob);

  const downloadLink = document.createElement('a');
  downloadLink.href = fileUrl;
  downloadLink.download = 'blocked-words.txt';
  document.body.appendChild(downloadLink);
  downloadLink.click();
  downloadLink.remove();
  URL.revokeObjectURL(fileUrl);

  showStatusMessage(`Exported ${words.length} ${pluralize(words.length, 'word', 'words')}.`);
}

function handleImport(event) {
  const selectedFile = event.target.files[0];
  if (!selectedFile) return;

  const fileReader = new FileReader();

  fileReader.onload = () => {
    const importedWords = String(fileReader.result)
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    const existingWords = parseWordsFromTextarea();
    const mergedWords = removeDuplicates([...existingWords, ...importedWords]);

    blockedWordsTextarea.value = mergedWords.join('\n');
    showStatusMessage(
      `Imported ${importedWords.length} ${pluralize(importedWords.length, 'word', 'words')}. Click "Save Words" to apply.`
    );
  };

  fileReader.onerror = () => showStatusMessage('Could not read that file.', true);
  fileReader.readAsText(selectedFile);

  importFileInput.value = '';
}

function showStatusMessage(message, isError = false) {
  clearTimeout(statusMessageTimer);
  statusMessageElement.textContent = message;
  statusMessageElement.classList.toggle('error', isError);
  statusMessageTimer = setTimeout(() => {
    statusMessageElement.textContent = '';
    statusMessageElement.classList.remove('error');
  }, STATUS_MESSAGE_DURATION_MS);
}
