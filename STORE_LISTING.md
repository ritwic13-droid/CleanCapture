# Store listing copy (Chrome Web Store / Edge Add-ons / Firefox AMO)

**Name:** CleanCapture – Full Page & Scrollable Area Screenshot
**Category:** Tools (Productivity)
**Summary (132 chars max):**
Full-page and scrollable-area screenshots with an editor, plus screen recording. PNG/JPEG/PDF. No ads, no tracking.

**Description:**
CleanCapture takes screenshots and nothing else.

• Full page — scrolls and stitches the whole page
• Pick element — hover to highlight any part of the page (a card, table, chat or scrolling panel) and click to capture all of it
• Selected area — drag a rectangle
• This tab — the part of the page you can see now
• Window or screen — another window, app or the whole screen

Built-in editor: crop with drag handles, shapes (rectangle, ellipse, line, arrow), pen, highlighter, eraser, resizable text, numbered steps, magnifier, blur (rectangle, ellipse or brush), opacity, undo/redo.
Select text inside the screenshot (offline text recognition), copy it or search it on Google.
New screenshots are copied to the clipboard automatically.
Export: PNG, JPEG, PDF (A4 pages or one long page), copy to clipboard, print.
Shortcuts: Alt+Shift+F / E / A / V.

Screen recording: switch the popup to "Record video". Pick an element or drag an area and it records right there on the page — no share dialog — with a 3-second countdown, a red frame, a timer and pause / edit frame / stop controls. Or record a browser tab, a window or the whole screen. When you stop, a video editor opens: trim, cut out parts, crop, mute, then save.

Privacy: no ads, no analytics, no accounts, no network access at all. Screenshots never leave your device.

**Single purpose:** Capture screenshots and screen recordings of web pages and annotate/export them locally.

**Permission justifications**
- `activeTab`: capture the tab the user explicitly invokes the extension on.
- `scripting`: inject the capture helper (scrolling, area/element picker) into that tab after the user's click.
- `clipboardWrite`: copy the new screenshot to the clipboard automatically when the editor opens.
- `tabCapture`: record the current tab after the user picks an element or area to record from the extension's popup, without a separate share dialog. Only that tab, only while recording; the video stays on the device.
- `offscreen`: hosts the recording of the current tab in a hidden extension page, because the background service worker cannot use media APIs. Nothing is shown or sent anywhere.
- Host permissions: none. Remote code: none. Bundled library: Tesseract.js (Apache-2.0) for offline text recognition, see vendor/tesseract/README.md.

**Data usage form:** collects no user data; tick all three compliance certifications.
**Privacy policy URL:** link to PRIVACY.md in the GitHub repo.
**Assets you must add:** at least one 1280×800 screenshot; 128×128 icon is `icons/128.png`.
