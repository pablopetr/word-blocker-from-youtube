# Word Blocker for YouTube

A browser extension that automatically hides or blurs YouTube videos whose
title or description contains words or phrases you'd rather not see.

## Features

- **Custom word list** — block any words or phrases, one per line, case-insensitive.
- **Two display modes**
  - **Blur** — blurs the thumbnail and shows an overlay explaining which word matched (hover to peek).
  - **Hide** — removes the video from the page entirely.
- **Works everywhere on YouTube** — home page, search results, channel pages, playlists, the "Up next" sidebar, and the Shorts shelf.
- **Live updates** — changes you save in the popup apply instantly, no page reload required.
- **Handles infinite scroll** — new videos loaded as you scroll are scanned automatically.
- **Live blocked counter** — the popup shows how many videos are currently blocked on the active tab.
- **Import / export** — save your word list to a `.txt` file or load one back in.

## How it works

A content script runs on every `youtube.com` page and scans each video "card"
YouTube renders, checking its title and (when visible) description snippet
against your blocked-word list. Matching videos are blurred or hidden.

Two mechanisms keep this in sync with a page that never stops changing:

1. A `MutationObserver` watches for new cards inserted by YouTube's
   infinite-scroll / lazy-loading as you scroll, and by its single-page-app
   navigation between videos and pages.
2. A `chrome.storage.onChanged` listener re-scans the page the moment you
   edit your word list or display mode in the popup.

Your word list and display mode are stored in `chrome.storage.sync` (synced
across your signed-in browsers); the live blocked-video count is stored in
`chrome.storage.local`.

## Installation (unpacked / developer mode)

1. Download or clone this repository.
2. Open `chrome://extensions` (or the equivalent in your Chromium-based browser).
3. Enable **Developer mode**.
4. Click **Load unpacked** and select this project's folder.
5. Pin the extension and open it to add your first blocked words.

## Usage

1. Click the extension icon to open the popup.
2. Enter the words or phrases you want blocked, one per line.
3. Choose a display mode: **Blur thumbnail + show overlay** or **Hide completely**.
4. Click **Save Words**. Changes apply immediately on any open YouTube tabs.
5. Use **Export list** / **Import list** to back up or transfer your word list between browsers.

## Project structure

| File | Purpose |
| --- | --- |
| `manifest.json` | Extension manifest (Manifest V3) — permissions and entry points. |
| `content.js` | Injected into YouTube pages; scans and blocks matching videos. |
| `popup.html` / `popup.css` | Markup and styling for the extension popup. |
| `popup.js` | Popup logic — loading/saving settings, import/export, live counter. |

## Permissions

- `storage` — to save your word list, display mode, and blocked-video count.
- `*://*.youtube.com/*` (host permission) — to run the content script on YouTube pages.
