# Firefox Add-ons (AMO) listing copy

Submit at https://addons.mozilla.org/developers/addon/submit/distribution → "On this site".
Upload `dist/clean-capture-firefox.zip` (built by `./build.sh`).

**Compatibility:** tick Firefox (desktop) only. Leave Firefox for Android unticked.
**Does your add-on use minified, concatenated or machine-generated code?** No. (No source upload needed.)

**Name:** Clean Capture – Full Page Screenshot
**Add-on URL slug:** clean-capture
**Summary (250 chars max):**
Full-page, scrollable-area and region screenshots with a built-in annotation editor. Export PNG, JPEG or PDF. No ads, no tracking, no network access.

**Description:**
Clean Capture takes screenshots and nothing else.

<b>Four ways to capture</b>
<ul>
<li>Full page — scrolls and stitches the whole page</li>
<li>Scrollable area — click a chat, table or panel that scrolls on its own</li>
<li>Selected area — drag a rectangle</li>
<li>Visible area — what you see right now</li>
</ul>

<b>Built-in editor</b>
Crop, arrows, lines, rectangles, ellipses, pen, highlighter, text, numbered steps, blur/pixelate, undo/redo.

<b>Export</b>
PNG, JPEG, PDF (A4 pages or one long page), copy to clipboard, print.

<b>Shortcuts</b>
Alt+Shift+F (full page), E (scrollable area), A (selected area), V (visible area).

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
No build step, no minified or third-party code, no remote code. Permissions: activeTab + scripting only, no host permissions.
The extension makes no network requests (CSP: connect-src 'none'). To test: open any web page, click the toolbar icon and choose "Full page".
