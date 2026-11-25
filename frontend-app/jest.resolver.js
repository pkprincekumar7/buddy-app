/**
 * Jest takes one resolver, so this chains the two the app needs:
 * - Reanimated's: skips Reanimated's and Worklets' *.native.* files under Jest
 *   (it hands everything else to Worklets' own resolver).
 * - @react-native/jest-preset's: drops react-native's package `exports` so its
 *   subpaths still resolve and can be mocked. A `resolver` in jest.config.js
 *   replaces the preset's, so it has to be called here.
 */
const reanimatedResolver = require('react-native-reanimated/jest/resolver');
const presetResolver = require('@react-native/jest-preset/jest/resolver');

/** @type {import('jest-resolve').SyncResolver} */
module.exports = (request, options) =>
  reanimatedResolver(request, {
    ...options,
    defaultResolver: (req, opts) =>
      presetResolver(req, {
        ...opts,
        defaultResolver: options.defaultResolver,
      }),
  });
