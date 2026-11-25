#!/usr/bin/env node
/**
 * postinstall — small, idempotent patches to installed node_modules that the
 * build needs. Each patch checks for its own "before" text, so re-running is a
 * no-op, and a failed patch only warns (like the old `|| true`) so it never
 * breaks `yarn install`.
 *
 * Run automatically by `yarn install` (package.json "postinstall").
 */
const fs = require('fs');
const path = require('path');

function patch(name, relFile, from, to) {
  const file = path.join(__dirname, '..', relFile);
  try {
    const src = fs.readFileSync(file, 'utf8');
    const next = src.replace(from, to);
    if (next !== src) {
      fs.writeFileSync(file, next);
      console.log(`postinstall: patched ${name}`);
    }
  } catch (e) {
    console.warn(`postinstall: could not patch ${name}: ${e.message}`);
  }
}

// metro-source-map throws on modules that ship a pre-compiled source map;
// skip them instead.
patch(
  'metro-source-map (pre-compiled source maps)',
  'node_modules/metro-source-map/src/source-map.js',
  /} else if \(map != null\) \{\n\s+throw new Error\([^)]+\);\n\s+}/,
  '} else if (map != null) {\n      // skip modules that already have a pre-compiled source map\n    }',
);

// image-size is pinned to ^2.0.4 (resolutions/overrides) for its DoS fixes
// (GHSA-5p2g-fcmc-qvqq, GHSA-w3rx-r6r6-pgpr). v2's imageSize() only accepts a
// Buffer, but Metro passes a file path for regular image assets — which breaks
// every Release bundle. Read the file first (Metro already does for .zip assets).
patch(
  'metro Assets (image-size v2 Buffer input)',
  'node_modules/metro/src/Assets.js',
  /const isImageInput = assetInfo\.files\[0\]\.includes\("\.zip\/"\)\n\s+\? _fs\.default\.readFileSync\(assetInfo\.files\[0\]\)\n\s+: assetInfo\.files\[0\];/,
  'const isImageInput = _fs.default.readFileSync(assetInfo.files[0]);',
);

// expo-modules-jsi 58.0.23 captures a `nonisolated(unsafe) let` pointer in a
// JavaScriptActor-isolated closure, which Swift 6.2 (Xcode 26) rejects with
// "sending 'slot' risks causing data races". Capture it through the package's
// own UncheckedSendable, as its other call sites do (see UncheckedSendable.swift).
patch(
  'expo-modules-jsi (Swift 6.2 sending slot)',
  'node_modules/expo-modules-jsi/apple/Sources/ExpoModulesJSI/Runtime/Values/JavaScriptObject.swift',
  /(\n(\s+)try runtime\._withUnsafeGuaranteedRef \{ runtime in\n\s+try JavaScriptActor\.assumeIsolated \{\n\s+try encode\(JavaScriptValue\.Slot\()slot(\), runtime\))/,
  '\n$2let sendableSlot = UncheckedSendable(slot)$1sendableSlot.value$3',
);
