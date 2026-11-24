#!/bin/sh
set -e
# Renders the nginx config at start:
# - API_UPSTREAM: where /api/* goes; the compose gateway by default, which routes each path
#   to its service as the ALB does (build plan 7.2).
# - ASSETS_BUCKET_NAME: when set, the template's /app-assets/ location proxies to that S3
#   bucket (its app-assets/* is public, local/aws-manual/README.md); without it the base
#   config answers /app-assets/* 404.
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
: "${ASSETS_BUCKET_NAME:=}"
# Only a bucket name: it's put into the proxied host name.
case "$ASSETS_BUCKET_NAME" in
    "") ;;
    *[!a-z0-9.-]*) echo "ASSETS_BUCKET_NAME must be an S3 bucket name, not '$ASSETS_BUCKET_NAME'." >&2; exit 1 ;;
esac
if [ -n "$LOCAL_S3_ORIGIN" ]; then
    UPLOADS_ORIGIN=$LOCAL_S3_ORIGIN
elif [ -n "$UPLOADS_BUCKET_NAME" ]; then
    UPLOADS_ORIGIN="https://$UPLOADS_BUCKET_NAME.s3.$AWS_REGION.amazonaws.com"
else
    UPLOADS_ORIGIN=
fi
export API_UPSTREAM UPLOADS_ORIGIN ASSETS_BUCKET_NAME
# shellcheck disable=SC2016  # envsubst takes the variable names literally
if [ -n "$ASSETS_BUCKET_NAME" ]; then
    envsubst '$API_UPSTREAM $ASSETS_BUCKET_NAME $UPLOADS_ORIGIN' \
        < /etc/nginx/conf.d/default.conf.template \
        > /etc/nginx/conf.d/default.conf
else
    envsubst '$API_UPSTREAM $UPLOADS_ORIGIN' \
        < /etc/nginx/conf.d/default.conf.base \
        > /etc/nginx/conf.d/default.conf
fi
exec nginx -g 'daemon off;'
