# Clean Capture

Full-page, scrollable-area, selected-area and visible-area screenshots with an annotation editor.
Exports PNG, JPEG and PDF. No ads, no tracking, no network access. See [PRIVACY.md](PRIVACY.md).

## Install from source

**Chrome, Edge, Brave, Opera, Vivaldi, Arc**
1. Download this repo (Code → Download ZIP, or https://github.com/ritwic13-droid/CleanCapture/archive/refs/heads/main.zip) and unzip it.
2. Open `chrome://extensions` (or `edge://extensions`), enable Developer mode.
3. Click **Load unpacked** and choose the folder.

**Firefox (140+)**
1. Run `./build.sh`.
2. Open `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on** → pick `dist/firefox/manifest.json`.
   Permanent installs need the zip signed through addons.mozilla.org.

**Safari (macOS / iOS / iPadOS)** — needs a Mac with Xcode:
`xcrun safari-web-extension-converter dist/chrome --app-name "Clean Capture"`

## Use
Click the toolbar icon and pick a mode, or use Alt+Shift+F (full page), E (scrollable area), A (selected area), V (visible area).

## Build store packages
`./build.sh` writes `dist/clean-capture-chrome.zip` and `dist/clean-capture-firefox.zip`. Listing text is in [STORE_LISTING.md](STORE_LISTING.md) (Chrome) and [FIREFOX_LISTING.md](FIREFOX_LISTING.md) (Firefox).
