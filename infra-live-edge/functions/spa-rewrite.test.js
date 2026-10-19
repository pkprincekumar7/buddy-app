'use strict'

// Unit tests for spa-rewrite.js — the CloudFront Function that gives the
// default /* behaviour its SPA fallback (EDGE-03 in
// docs/production-readiness-review.md).
//
// CloudFront Functions have no module system, so the file is evaluated in a
// vm sandbox and its top-level handler() is pulled out, exactly as the
// runtime would call it.
//
// Run with: node --test infra-live-edge/functions/spa-rewrite.test.js

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const code = fs.readFileSync(path.join(__dirname, 'spa-rewrite.js'), 'utf8')
const handler = vm.runInNewContext(code + '\n;handler')

function rewrite(uri) {
  return handler({ request: { uri, method: 'GET', querystring: {}, headers: {}, cookies: {} } }).uri
}

test('spa-rewrite', async (t) => {
  await t.test('client-side routes are rewritten to /index.html', () => {
    for (const uri of [
      '/',
      '/Login',
      '/Register',
      '/Admin',
      '/Login/',
      '/Onboarding/665f1c2ab3e4d5f6a7b8c9d0',
      '/GrowthAreas/665f1c2ab3e4d5f6a7b8c9d0/Activity/drawing/GreatInsights',
      '/some/unknown/route',
    ]) {
      assert.equal(rewrite(uri), '/index.html', uri)
    }
  })

  await t.test('files (last segment has an extension) pass through unchanged', () => {
    for (const uri of ['/index.html', '/manifest.json', '/theme-init.js', '/orb-voice.mp3', '/fonts/Orbitron-Bold.woff2']) {
      assert.equal(rewrite(uri), uri, uri)
    }
  })

  await t.test('a dot in a directory, not the last segment, still counts as a route', () => {
    assert.equal(rewrite('/v1.2/Login'), '/index.html')
  })

  await t.test('missing Vite chunks are not rewritten (S3 returns a real 404)', () => {
    assert.equal(rewrite('/assets/index-missing.js'), '/assets/index-missing.js')
    assert.equal(rewrite('/assets/no-extension'), '/assets/no-extension')
  })

  await t.test('/uploads/ for an undeployed location is never turned into the SPA', () => {
    assert.equal(rewrite('/uploads/br/photo.jpg'), '/uploads/br/photo.jpg')
    assert.equal(rewrite('/uploads/br/no-extension'), '/uploads/br/no-extension')
  })

  await t.test('/api/ and /app-assets/ are never rewritten, even without an extension', () => {
    assert.equal(rewrite('/api/v1/does-not-exist'), '/api/v1/does-not-exist')
    assert.equal(rewrite('/app-assets/child_activity_game/thing'), '/app-assets/child_activity_game/thing')
  })

  await t.test('only uri changes; the rest of the request is returned as-is', () => {
    const request = { uri: '/Login', method: 'GET', querystring: { a: { value: '1' } }, headers: { host: { value: 'x' } }, cookies: {} }
    const out = handler({ request })
    assert.equal(out, request)
    assert.deepEqual(out.querystring, { a: { value: '1' } })
    assert.deepEqual(out.headers, { host: { value: 'x' } })
  })
})
