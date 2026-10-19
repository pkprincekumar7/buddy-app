// CloudFront Function (cloudfront-js-2.0, viewer-request) — SPA fallback for
// the default /* behaviour only. See ../terraform/cloudfront.tf.
//
// Replaces the old distribution-wide custom_error_response (404 → 200
// /index.html), which also turned every API 404 into 200 HTML and every
// missing JS/CSS chunk into 200 HTML (a MIME-type error instead of a
// detectable 404). Now only client-side routes get index.html:
//
//   - The last path segment has no "." → it's an SPA route
//     (/Login, /GrowthAreas/<id>/Activity/<a>) → rewrite to /index.html.
//   - It has a "." → it's a file (/assets/index-abc.js, /manifest.json) →
//     pass through; a missing file is a real 404 from S3.
//   - Never rewritten, whatever the extension: the prefixes below. /api/* and
//     /app-assets/* have their own behaviours and never reach this function;
//     /assets/* and /uploads/* (photos are private, fetched straight from S3
//     with presigned URLs — EDGE-05) do fall through to the default
//     behaviour, and must 404, not return the SPA.
//
// A future client route with a "." in its last segment would be treated as a
// file and 404. So would a dotless file (e.g. /.well-known/
// apple-app-site-association) — add an exception here if one is introduced.
//
// No module.exports: CloudFront Functions expect a bare top-level handler.
// spa-rewrite.test.js loads this file in a vm sandbox.

var PASS_THROUGH_PREFIXES = ['/api/', '/app-assets/', '/assets/', '/uploads/']

function handler(event) {
  var request = event.request
  var uri = request.uri

  for (var i = 0; i < PASS_THROUGH_PREFIXES.length; i++) {
    if (uri.startsWith(PASS_THROUGH_PREFIXES[i])) {
      return request
    }
  }

  var lastSegment = uri.substring(uri.lastIndexOf('/') + 1)
  if (lastSegment.indexOf('.') === -1) {
    request.uri = '/index.html'
  }
  return request
}
