# Build
FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

# Vite + Tailwind/postcss configs (vite.config.ts / tsconfig.json do not exist in this project)
COPY index.html vite.config.js tailwind.config.js postcss.config.cjs jsconfig.json ./
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
FROM nginx:1.27-alpine
COPY --from=build /app/dist /usr/share/nginx/html
# Base config (used as-is when BACKEND_BUCKET_NAME is not set).
COPY nginx.conf /etc/nginx/conf.d/default.conf
# Template used when BACKEND_BUCKET_NAME is set — nginx-start.sh runs envsubst and overwrites default.conf.
COPY nginx.conf.template /etc/nginx/conf.d/default.conf.template
COPY nginx-start.sh /nginx-start.sh
RUN chmod +x /nginx-start.sh
EXPOSE 80
CMD ["/nginx-start.sh"]
