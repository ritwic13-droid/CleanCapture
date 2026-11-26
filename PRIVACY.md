# Privacy policy — CleanCapture

CleanCapture does not collect, transmit, sell or share any data.

- It makes no network requests to any server. Its content security policy sets `connect-src 'self'`, so it can only load files that ship inside the extension itself.
- Text recognition ("Select text") runs entirely on your device using a bundled copy of Tesseract.
- "Search Google" opens an ordinary Google search tab containing only the text you selected, and only when you click it.
- New screenshots are copied to your clipboard when the editor opens (`clipboardWrite`). Nothing is read from the clipboard.
- It contains no analytics, ads, affiliate code or remote code.
- It can only access a page after you click its toolbar icon or press one of its shortcuts (`activeTab`).
- Screenshots are stored only in your browser's local extension storage (the 5 most recent) so the editor can open them.
- Screen recordings are made in your browser. When you stop, the recording is kept in the extension's local storage
  (with the screenshots, 5 most recent in total) so the video editor can open it, until you save it to your downloads
  folder or clear it. Recordings are never uploaded.
- Recording an element or area records only the tab you started it on, only while the red frame is showing (`tabCapture` in Chrome).
- The microphone is used only if you tick "Include microphone" on the recorder page.
- Remove stored screenshots any time with "Clear saved captures" in the popup, or by uninstalling the extension.
