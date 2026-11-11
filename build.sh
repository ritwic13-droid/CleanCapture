#!/usr/bin/env bash
# Builds store-ready zips: dist/clean-capture-chrome.zip (Chrome, Edge, Brave, Opera, Vivaldi)
# and dist/clean-capture-firefox.zip (Firefox 140+).
set -euo pipefail
cd "$(dirname "$0")"
FILES="manifest.json background.js content.js db.js editor.html editor.css editor.js popup.html popup.css popup.js recorder.html recorder.css recorder.js icons vendor"
rm -rf dist && mkdir -p dist/chrome dist/firefox
cp -r $FILES dist/chrome/
cp -r $FILES dist/firefox/
python3 - <<'PY'
import json
p = 'dist/firefox/manifest.json'
m = json.load(open(p))
m['name'] = 'Clean Capture – Full Page Screenshot'   # AMO limits names to 45 characters
m['background'] = {'scripts': ['background.js'], 'type': 'module'}
m['browser_specific_settings'] = {'gecko': {
    'id': 'clean-capture@ritwic13-droid.github.io',
    'strict_min_version': '140.0',
    'data_collection_permissions': {'required': ['none']}}}
json.dump(m, open(p, 'w'), indent=2)
PY
(cd dist/chrome && zip -qr ../clean-capture-chrome.zip .)
(cd dist/firefox && zip -qr ../clean-capture-firefox.zip .)
ls -la dist/*.zip
