# Firefox Add-ons (AMO) listing copy

Submit at https://addons.mozilla.org/developers/addon/submit/distribution → "On this site".
Upload `dist/clean-capture-firefox.zip` (built by `./build.sh`).

**Compatibility:** tick Firefox (desktop) only. Leave Firefox for Android unticked.
**Does your add-on use minified, concatenated or machine-generated code?** Only the unmodified third-party library in `vendor/tesseract/` (published npm builds). Our own code is not minified. If asked for sources, link the npm packages listed in vendor/tesseract/README.md.

**Name:** Clean Capture – Full Page Screenshot
**Add-on URL slug:** clean-capture
**Summary (250 chars max):**
Full-page, scrollable-area and region screenshots with a built-in annotation editor. Export PNG, JPEG or PDF. No ads, no tracking, no network access.

**Description:**
Clean Capture takes screenshots and nothing else.

<b>Four ways to capture</b>
<ul>
<li>Full page — scrolls and stitches the whole page</li>
<li>Pick element — hover to highlight any part of the page (a card, table, chat or scrolling panel) and click to capture all of it</li>
<li>Selected area — drag a rectangle</li>
<li>Visible area — what you see right now</li>
</ul>

<b>Built-in editor</b>
Crop with drag handles, shapes (rectangle, ellipse, line, arrow), pen, highlighter, eraser, resizable text, numbered steps, magnifier, blur (rectangle, ellipse or brush), opacity, undo/redo. Select text inside the screenshot (offline text recognition), copy it or search it on Google. New screenshots are copied to the clipboard automatically.

<b>Export</b>
PNG, JPEG, PDF (A4 pages or one long page), copy to clipboard, print.

<b>Shortcuts</b>
Alt+Shift+F (full page), E (pick element), A (selected area), V (visible area).

<b>Screen recording</b>
Record a tab, a window or the whole screen as WebM or MP4, with optional audio and microphone, pause and resume.

<b>Private by design</b>
No ads, no analytics, no accounts and no network access at all. Screenshots never leave your device. The source is open: https://github.com/ritwic13-droid/CleanCapture

**Categories:** Photos, Music & Videos (or "Other"); second choice: Web Development
**Tags:** screenshot, full page, pdf, annotate
**License:** MIT License
**Support site / Homepage:** https://github.com/ritwic13-droid/CleanCapture
**Privacy policy:** tick "This add-on has a privacy policy" and paste the text of PRIVACY.md
**Screenshots:** upload the five files `store-assets/screenshot-*.png`
**Icon:** taken from the package automatically

**Notes to reviewer:**
No build step and no remote code. Permissions: activeTab, scripting, clipboardWrite; no host permissions.
Third-party code (unmodified, from npm): vendor/tesseract/ contains tesseract.js 7.0.0 and tesseract.js-core 7.0.0 (minified as published) plus English language data, used for offline text recognition. Sources and licences are listed in vendor/tesseract/README.md.
The extension makes no requests to any server (CSP: connect-src 'self'; 'wasm-unsafe-eval' is needed for the Tesseract WebAssembly module). To test: open any web page, click the toolbar icon and choose "Full page".
