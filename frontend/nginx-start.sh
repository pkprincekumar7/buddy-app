#!/bin/sh
set -e
# Renders the nginx config at start:
# - API_UPSTREAM: where /api/* goes; the compose gateway by default, which routes each path
#   to its service as the ALB does (build plan 7.2).
# - ASSETS_BUCKET_NAME: when set, the template's /app-assets/ location proxies to that S3
#   bucket; without it the base config returns 404 for missing assets.
# - LOCAL_S3_ORIGIN: the local S3 (Moto) origin the API presigns photo URLs for, added to the
#   CSP's img-src and connect-src so the browser may upload and show them; empty adds nothing.
#   Deployed, the app is served by CloudFront with its own CSP (infra-live-edge), not this.
# envsubst replaces only the variables named, so nginx's own $host etc. stay as they are.
: "${API_UPSTREAM:=gateway:8080}"
: "${LOCAL_S3_ORIGIN:=}"
export API_UPSTREAM LOCAL_S3_ORIGIN
# shellcheck disable=SC2016  # envsubst takes the variable names literally
if [ -n "$ASSETS_BUCKET_NAME" ]; then
    envsubst '$API_UPSTREAM $ASSETS_BUCKET_NAME $LOCAL_S3_ORIGIN' \
        < /etc/nginx/conf.d/default.conf.template \
        > /etc/nginx/conf.d/default.conf
else
    envsubst '$API_UPSTREAM $LOCAL_S3_ORIGIN' \
        < /etc/nginx/conf.d/default.conf.base \
        > /etc/nginx/conf.d/default.conf
fi
exec nginx -g 'daemon off;'
