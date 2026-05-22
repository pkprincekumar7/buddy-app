#!/bin/sh
set -e
# If a backend S3 bucket is configured, substitute it into the nginx template
# so the /assets/ location proxies missing paths to S3.
# Without the variable the base nginx.conf is used (returns 404 for missing assets).
if [ -n "$BACKEND_BUCKET_NAME" ]; then
    envsubst '$BACKEND_BUCKET_NAME' \
        < /etc/nginx/conf.d/default.conf.template \
        > /etc/nginx/conf.d/default.conf
fi
exec nginx -g 'daemon off;'
