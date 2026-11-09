#!/bin/sh
set -e
# Renders the nginx config at start:
# - API_UPSTREAM: where /api/* goes; the compose gateway by default, which routes each path
#   to its service as the ALB does (build plan 7.2).
# - ASSETS_ORIGIN: an environment's CloudFront site (https://<fqdn>). When set, the template's
#   /app-assets/ location proxies to it; without it the base config answers /app-assets/* 404.
# - UPLOADS_ORIGIN: the one origin the API presigns photo URLs for, added to the CSP's img-src
#   and connect-src so the browser may upload and show them, as prod's CSP allows only the
#   uploads buckets (infra-live-edge). LOCAL_S3_ORIGIN (the local S3, Moto) when set, else
#   UPLOADS_BUCKET_NAME's regional endpoint (AWS_REGION); neither adds nothing.
#   Deployed, the app is served by CloudFront with its own CSP (infra-live-edge), not this.
# envsubst replaces only the variables named, so nginx's own $host etc. stay as they are.
: "${API_UPSTREAM:=gateway:8080}"
: "${LOCAL_S3_ORIGIN:=}"
: "${UPLOADS_BUCKET_NAME:=}"
: "${AWS_REGION:=ap-south-1}"
: "${ASSETS_ORIGIN:=}"
# No trailing slash: proxy_pass with a path would replace /app-assets/ instead of passing it on.
ASSETS_ORIGIN=${ASSETS_ORIGIN%/}
# Only https://<host>: no scheme would make proxy_pass invalid (nginx won't start), and a
# path would replace /app-assets/.
case "$ASSETS_ORIGIN" in
    "") ;;
    https://*/*) echo "ASSETS_ORIGIN must be https://<host> with no path, not '$ASSETS_ORIGIN'." >&2; exit 1 ;;
    https://?*) ;;
    *) echo "ASSETS_ORIGIN must be https://<host>, not '$ASSETS_ORIGIN'." >&2; exit 1 ;;
esac
if [ -n "$LOCAL_S3_ORIGIN" ]; then
    UPLOADS_ORIGIN=$LOCAL_S3_ORIGIN
elif [ -n "$UPLOADS_BUCKET_NAME" ]; then
    UPLOADS_ORIGIN="https://$UPLOADS_BUCKET_NAME.s3.$AWS_REGION.amazonaws.com"
else
    UPLOADS_ORIGIN=
fi
export API_UPSTREAM UPLOADS_ORIGIN ASSETS_ORIGIN
# shellcheck disable=SC2016  # envsubst takes the variable names literally
if [ -n "$ASSETS_ORIGIN" ]; then
    envsubst '$API_UPSTREAM $ASSETS_ORIGIN $UPLOADS_ORIGIN' \
        < /etc/nginx/conf.d/default.conf.template \
        > /etc/nginx/conf.d/default.conf
else
    envsubst '$API_UPSTREAM $UPLOADS_ORIGIN' \
        < /etc/nginx/conf.d/default.conf.base \
        > /etc/nginx/conf.d/default.conf
fi
exec nginx -g 'daemon off;'
