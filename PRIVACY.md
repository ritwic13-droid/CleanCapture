# Privacy policy — Clean Capture

Clean Capture does not collect, transmit, sell or share any data.

- It makes no network requests to any server. Its content security policy sets `connect-src 'self'`, so it can only load files that ship inside the extension itself.
- Text recognition ("Select text") runs entirely on your device using a bundled copy of Tesseract.
- "Search Google" opens an ordinary Google search tab containing only the text you selected, and only when you click it.
- New screenshots are copied to your clipboard when the editor opens (`clipboardWrite`). Nothing is read from the clipboard.
- It contains no analytics, ads, affiliate code or remote code.
- It can only access a page after you click its toolbar icon or press one of its shortcuts (`activeTab`).
- Screenshots are stored only in your browser's local extension storage (the 5 most recent) so the editor can open them.
- Screen recordings are made in your browser and held in memory until you save them to your own downloads folder.
  They are never uploaded or stored by the extension. The microphone is used only if you tick "Include microphone".
- Remove stored screenshots any time with "Clear saved captures" in the popup, or by uninstalling the extension.
