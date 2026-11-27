# In-page recording: plan and reference

Status: **1.6.0 done** (Chrome tested; Firefox needs a manual check) · Version: **1.6.0** · This document is the source of truth for the change. It is updated as the work lands (see "Progress").

## 1. Problem

Recording a **picked element** or **selected area** today:

1. The user picks the element or drags the area on their page.
2. A *new* recorder tab opens.
3. The browser's share dialog asks them to choose a tab or window, and they must find the tab they were already on.
4. Recording runs from that other tab, with no indication on the page of what is being recorded.

That is three unnecessary steps and a context switch for something the user already told us.

## 2. Desired flow

1. Popup → **Record video** → **Pick element** or **Selected area**.
2. The user picks the element or drags the area **on the page they are on**.
2a. *(Added in 1.6.0, §12)* A **ready** step: frame and panel appear, the page stays usable, and the user chooses **Start recording**, **Edit frame** or **Cancel**.
3. **No share dialog, no new tab.** The extension records the tab the user is on.
4. A **3-second countdown** appears over the chosen region.
5. Recording starts. The region gets a **red outline**. At its **top-right corner** a control bar shows:
   - a **blinking red dot** and a **running timestamp**
   - **Pause / Resume**
   - **Edit frame**: move or resize the recorded region (recording pauses while editing)
   - **Stop**
6. **Stop** opens a **video editor tab** where the user can review, trim, cut, crop and save the recording.

## 3. Does it make sense?

Yes. Notes and constraints:

| Topic | Decision |
|---|---|
| Skipping the share dialog | Possible in **Chrome / Edge** with the `tabCapture` API: the extension may capture the tab the user invoked it on, without a picker. Needs new permissions `tabCapture` and `offscreen` (recording runs in a hidden extension page because a service worker cannot record). |
| Firefox | **Same flow in Firefox** (requested during the work). Firefox has no `tabCapture`, but `tabs.captureTab` can grab any rectangle of the page the user invoked the extension on, without a share dialog. The background page grabs the region about 15 times a second, draws each grab onto a canvas and records the canvas. Trade-offs: **no sound**, and a lower, less even frame rate than Chrome (about 10–15 fps depending on the page). Needs no new Firefox permissions. |
| Keeping the controls out of the video | The red outline is drawn just **outside** the region and the control bar sits **above** its top-right corner, so neither appears in the recording. If the region touches the top of the window, the bar moves below the region; if there is no room outside at all, it sits inside the corner and will be visible in the video (documented limitation). |
| Countdown | Drawn over the region and removed before the first frame is recorded. Esc cancels. |
| Edit frame mid-recording | Recording pauses, the frame gets drag handles, **Done** resumes. The video keeps its original size; a frame with a different shape is fitted inside it with dark bars. |
| Picked element that moves | If the page scrolls, the frame follows the element. Parts of it outside the window are recorded as dark. A selected *area* stays fixed on screen. |
| Sound | Tab sound is recorded and still plays for the user while recording. Microphone is not offered in in-page mode (a hidden page cannot ask for microphone permission); it stays available on the recorder page. |
| Leaving the page | Navigating away or closing the tab stops the recording and opens the editor with what was captured. |
| Whole tab, window or screen | Unchanged: these still use the browser's share dialog, which is where you choose them. |

## 4. Architecture (Chrome)

```
popup ──start(record, element|area)──► background (service worker)
                                         │ injects content.js, asks it to pick
content.js (picker) ──picked(rect)─────► background
                                         │ tabCapture.getMediaStreamId(tab)
                                         │ creates offscreen.html (reason USER_MEDIA)
content.js (overlay) ◄─countdown────────┤
content.js ──countdown done────────────► background ──start(streamId, rect)──► offscreen.js
                                                                         getUserMedia(tab stream)
                                                                         crop frames to rect
                                                                         MediaRecorder → WebM
overlay buttons ──pause/resume/frame/stop──► background ──► offscreen.js
offscreen.js ──saved(id)───────────────► background ──opens──► video.html?id=…
```

- **Region coordinates** are CSS pixels of the tab's viewport. Tab frames are scaled by `frame.width / viewport width`.
- **Cropping** uses `MediaStreamTrackProcessor` → canvas copy → `MediaStreamTrackGenerator` (proven in 1.4 testing; direct `visibleRect` cropping produced black frames).
- **Storage**: the finished WebM is stored in the extension's local IndexedDB (same store as screenshots, `type: 'video'`) and opened by id. Nothing leaves the device.
- **Duration fix**: MediaRecorder WebM has no duration; the existing fix moves to a shared `webm.js` used by both recorders.

### Firefox variant

```
content.js (picker + overlay) ──picked / countdown──► background (event page, has a DOM)
                                                       ffrec.js: loop { tabs.captureTab(rect) → canvas }
                                                                 canvas.captureStream → MediaRecorder → WebM
overlay buttons ──pause/resume/region/stop──────────► background → ffrec.js
content.js pings every 10 s so Firefox keeps the background page alive while recording.
```

- `captureTab`'s rectangle is in document coordinates, so the overlay sends the page scroll offset with every region update.

## 5. Overlay spec (in the page)

- Rendered in a closed shadow root so page styles cannot affect it and it cannot affect the page.
- **Frame**: 3px red (`#ef4444`) outline, offset 3px outside the region, `pointer-events: none` so the page stays usable.
- **Countdown**: large white number in a dark circle at the region's centre; "Esc to cancel" below.
- **Control bar**: dark pill (`#111827`), above the frame's top-right corner.
  - `●` red dot, blinks while recording, grey square while paused (shape change, not colour alone)
  - `00:00` timestamp, tabular numerals, counts recorded time only
  - **Pause** / **Resume**
  - **Edit frame** / **Done**
  - **Stop** (red)
- **Edit frame mode**: 8 handles plus drag inside to move; frame clamped to the window; bar shows "Done".
- Keyboard: every control is a real button; Esc during countdown cancels.
- Screen-reader: bar is a labelled toolbar; state changes announced via a live region.

## 6. Video editor spec (`video.html`)

- **Preview**: video with play/pause, current time / total, click-to-seek.
- **Timeline**: thumbnail strip, playhead, the kept segments drawn as blocks.
  - **Trim**: drag the start and end handles.
  - **Split** at the playhead (S), **Delete** the selected segment (Delete key) to cut out a middle section.
  - Playback skips removed parts.
- **Crop**: frame with 8 handles over the preview, Apply / Reset.
- **Mute** sound toggle (shown when the recording has sound).
- **Undo / Redo** (Ctrl+Z / Ctrl+Shift+Z).
- **Save**:
  - no edits → saves the original file instantly
  - with edits → renders in the browser in real time (a 30-second clip takes about 30 seconds), with a progress bar, then saves WebM
- Keyboard: Space play/pause, ← / → step 1 s (Shift = 5 s), S split, Delete remove segment.

## 7. Permissions

| Permission | Why | Store justification |
|---|---|---|
| `tabCapture` | Record the tab the user started a recording on, without the share dialog | Records the current tab after the user picks an element or area to record from the extension's popup. Only that tab, only while recording, and the video stays on the device. |
| `offscreen` | A service worker cannot record video; a hidden extension page does the recording | Hosts the recording of the current tab in a hidden extension page, because the background service worker cannot use media APIs. No content is shown or sent anywhere. |

Firefox build: both are removed (not supported there). Firefox uses `tabs.captureTab`, covered by the existing `activeTab` permission.

## 8. Test plan

| # | Test | How |
|---|---|---|
| T1 | Pick element → countdown → recording starts without a share dialog or new tab | Playwright, Chromium with the extension |
| T2 | Selected area → same | Playwright |
| T3 | Overlay outline and bar are not in the recorded frames | Inspect saved video frames |
| T4 | Pause excludes time; timestamp matches recorded time | Compare duration to wall clock |
| T5 | Edit frame changes the recorded region | Inspect frames before / after |
| T6 | Stop opens the video editor with the recording | Playwright |
| T7 | Editor: trim, split + delete, crop, mute, save; output duration and size correct | ffprobe on the saved file |
| T8 | Navigating away stops and opens the editor | Playwright |
| T9 | Screenshot modes, popup, recorder page still work (regression) | Existing test scripts |
| T10 | Accessibility scan of popup, editor, video editor | axe |
| T11 | Firefox package passes Mozilla's linter | web-ext lint |
| T12 | Firefox in-page recording | Not possible here (no Firefox in the test environment): logic shared with Chrome where possible; needs a manual check |

## 9. Progress

- [x] Plan written
- [x] Offscreen recorder + tabCapture wiring (`offscreen.html/js`, `background.js`)
- [x] In-page overlay: countdown, frame, control bar, edit frame (`content.js`)
- [x] Video editor (`video.html/css/js`)
- [x] Recorder page hands off to video editor (`recorder.js`)
- [x] Firefox in-page recorder (`ffrec.js`) and build adjustments (`build.sh`)
- [x] Tests T1–T11 (results in §10)
- [x] Docs, store copy, version 1.5.0, packages, GitHub push
- [ ] T12: manual check in Firefox

## 10. Test results (Chromium, automated)

Chrome only lets an extension capture a tab after the user clicks its toolbar button or uses its shortcut. The automated tests cannot click the toolbar, so they ran with Chromium's testing switch `--allowlisted-extension-id`, which stands in for that click. Everything after that point is the real code path.

| # | Result |
|---|---|
| T1 | ✅ Pick element: countdown, then recording with **no share dialog and no new tab**. Output exactly the element's size (400 × 240). |
| T2 | ✅ Selected area: output exactly the dragged size (400 × 250). Esc during the countdown cancels and removes the overlay. |
| T3 | ✅ No red frame pixels on any edge of the recorded frames. A first run showed the control bar's shadow 10px into the top of the video; fixed by keeping the bar 16px clear of the region, re-checked: top rows clean. |
| T4 | ✅ Pausing for 1.5 s left the recorded length matching the on-screen timer. |
| T5 | ✅ Edit frame: narrowing the frame mid-recording is fitted into the original video size with dark side bars, as specified. The frame followed the element when the page scrolled. |
| T6 | ✅ Stop opens the video editor in the next tab with the recording (length, size and thumbnails correct). |
| T7 | ✅ Editor: split at 1.0 s, delete the first part, trim the end by 1.5 s, crop to 60 %, mute, undo/redo. Saved file: 1.82 s (expected 1.8), 240 × 150, no sound track. |
| T8 | ✅ Navigating the page during recording stops it and opens the editor. |
| T9 | ✅ Screenshot modes, popup (both modes) and recorder page still work; recorder-page recordings now open in the video editor too. |
| T10 | ✅ axe: 0 violations on popup (light, dark), screenshot editor, recorder, video editor (after fixing two findings in the video editor timeline). |
| T11 | ✅ Firefox package: 0 errors. New warnings are the Chrome-only APIs (`offscreen`, `tabCapture`), which the code checks for before using. |
| T12 | ⏳ Not run: no Firefox in the test environment. |

## 11. Known limitations

- **Firefox:** in-page recording has no sound and a lower frame rate (about 10–15 fps).
- **Microphone** is not available in in-page recording; use **Browser tab** or **Window or screen** for narration.
- If the region fills the whole window, the control bar has to sit inside it and will appear in the video.
- Saving an edited video takes about as long as the edited video plays.

## 12. Change for 1.6.0: a "ready" step before the countdown

**Request:** after picking the element or area, the user should be able to adjust things before recording starts: move the frame, scroll the page, and use the page normally (for example play, pause or scrub a video), then choose to start, edit the frame, or cancel, from the same panel at the frame's top-right.

**New flow**

1. Pick an element or drag an area (unchanged).
2. **Ready:** the red frame and the panel appear at once. Nothing is being recorded yet.
   - Panel: grey dot, "Ready", **Start recording** (red), **Edit frame**, **Cancel**.
   - The page works normally: scroll, click, type, play or scrub videos. The frame ignores the mouse, so clicks go to the page underneath.
   - **Edit frame** gives the frame its handles; **Done** returns to ready. A picked element is still followed when the page scrolls.
   - **Cancel** or Esc removes everything.
3. **Start recording** → 3-second countdown → recording, exactly as in 1.5. Esc during the countdown goes back to ready instead of cancelling.
4. Recording controls and Stop → editor are unchanged.

**Design notes**

- The frame is dashed and dimmer while ready, and solid red once recording, so it's clear when recording is actually happening.
- The background no longer waits for the countdown. The page tells it when to start (`recGo`), so a long ready step can't time out the background service worker.
- Tab capture is still allowed after a long ready step: Chrome keeps the toolbar-click permission until the page navigates or closes.

**Tests**

| # | Test |
|---|---|
| T13 | Ready panel appears after picking, with Start recording / Edit frame / Cancel, and nothing is recorded yet |
| T14 | While ready: clicking, typing and scrubbing a slider on the page work; scrolling moves the frame with a picked element |
| T15 | Edit frame while ready changes the region; the recording uses the new region |
| T16 | Cancel and Esc while ready remove the overlay; Esc during the countdown returns to ready |
| T17 | Start → countdown → recording → Stop → editor still works (T1–T8 re-run) |

**Progress**

- [x] Plan updated
- [x] Ready step in the overlay (`content.js`) and `recGo` start in the background (`background.js`)
- [x] Tests T13–T17
- [x] Version 1.6.0, packages, docs, GitHub push
- [ ] Manual check in Firefox (still open from T12)

**Results (Chromium, automated, same testing switch as §10)**

| # | Result |
|---|---|
| T13 | ✅ After picking: dashed frame, panel shows "Ready", Start recording / Edit frame / Cancel. No recorder page running. |
| T14 | ✅ While ready: clicked the page's video to play it, clicked a button twice, typed text, moved a slider, scrubbed the video; all worked. Scrolling moved the frame 60px with the element. Still nothing recorded. |
| T15 | ✅ Edit frame while ready: width 412 → 312; the recording came out 300 × 240 to match. |
| T16 | ✅ Esc and Cancel while ready remove the overlay. Esc during the countdown returns to ready, and the recorder never started. |
| T17 | ✅ Start → countdown → solid frame, Pause / Edit frame / Stop → Stop → editor. T1–T8, screenshot tests, accessibility scans (0 violations) and the Firefox linter (0 errors) re-run and passing. |
