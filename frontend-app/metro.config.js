const { getDefaultConfig } = require('expo/metro-config');
const { mergeConfig } = require('@react-native/metro-config');
const { withNativeWind } = require('nativewind/metro');

const config = mergeConfig(getDefaultConfig(__dirname), {});

// inlineRem: 16 — match the browser's 16px rem so every Tailwind spacing/size
// class (p-4, text-sm, h-9, …) renders at the same pixel size as the web app.
// NativeWind's own default is 14, which would shrink every ported layout.
module.exports = withNativeWind(config, {
  input: './global.css',
  inlineRem: 16,
});
