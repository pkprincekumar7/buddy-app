# Build
# Both base images pinned by digest (production-readiness review, CI-04); Dependabot bumps
# tag and digest together. nginx matches the local gateway's (docker-compose.yml).
FROM node:22.23.5-alpine3.24@sha256:1314fb30ec37592d5845e5a160d522c0e680972aa534549940b8d73bde88481a AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

# Vite + Tailwind/postcss configs + TypeScript project references
COPY index.html vite.config.ts tailwind.config.ts postcss.config.ts \
     tsconfig.json tsconfig.app.json tsconfig.node.json tsconfig.e2e.json ./
COPY public ./public/
COPY src ./src

# Embed at build time (Vite bakes env into static assets).
# Embed full API URL in static builds when UI and API live on different hosts.
ARG VITE_API_URL=
ENV VITE_API_URL=${VITE_API_URL}
ARG VITE_GOOGLE_CLIENT_ID=
ENV VITE_GOOGLE_CLIENT_ID=${VITE_GOOGLE_CLIENT_ID}

RUN npm run build

# Serve
FROM nginx:1.31.9-alpine@sha256:fb4658584bd9a916ffb6f6e365f97c25cfdb2923801f551ea08356e695f14ff7
COPY --from=build /app/dist /usr/share/nginx/html
# Base config (used as-is when ASSETS_BUCKET_NAME is not set).
COPY nginx.conf /etc/nginx/conf.d/default.conf.base
# Template used when ASSETS_BUCKET_NAME is set — nginx-start.sh runs envsubst and overwrites default.conf.
COPY nginx.conf.template /etc/nginx/conf.d/default.conf.template
COPY nginx-start.sh /nginx-start.sh
RUN chmod +x /nginx-start.sh \
    && chown -R nginx:nginx /usr/share/nginx/html \
    && chown -R nginx:nginx /var/cache/nginx \
    && chown -R nginx:nginx /etc/nginx/conf.d \
    && touch /var/run/nginx.pid \
    && chown nginx:nginx /var/run/nginx.pid \
    && chown nginx:nginx /nginx-start.sh
# The image's nginx user, by number (hadolint DL3066): 101:101 in the official nginx images.
USER 101:101
EXPOSE 8080
# Exec form (hadolint DL3025): no shell. wget exits non-zero on any failure, which Docker
# counts as unhealthy, as `|| exit 1` did.
HEALTHCHECK --interval=10s --timeout=3s CMD ["wget", "-q", "-O", "/dev/null", "http://localhost:8080/manifest.json"]
CMD ["/nginx-start.sh"]
