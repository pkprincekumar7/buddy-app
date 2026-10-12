FROM python:3.13-slim

# Git metadata baked in at build time — no .git directory or git binary needed.
# CI passes real values via --build-arg; local/scan builds default to "unknown".
# GIT_SHA is declared here (rather than down with the other GIT_* args) so it can
# double as a cache-bust key for the apt-get layer below: referencing it in that
# RUN command forces Docker to invalidate the cache on every real build (CI's
# GIT_SHA changes every commit), instead of silently reusing a stale cached
# layer that never re-fetches newly published Debian security patches (e.g.
# openssl/libssl3t64 CVE-2026-14456) — apt-get itself would happily install
# them, but a cached layer never re-runs apt-get update at all.
ARG GIT_SHA=unknown

# Pull in Debian security patches not yet baked into the base image (e.g. util-linux CVE-2026-53615).
RUN echo "cache-bust: ${GIT_SHA}" \
    && apt-get update && apt-get upgrade -y && rm -rf /var/lib/apt/lists/*

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

ARG GIT_BRANCH=unknown
ARG GIT_COMMITTED_AT=unknown
ARG GIT_TAG=
ENV GIT_SHA=$GIT_SHA
ENV GIT_BRANCH=$GIT_BRANCH
ENV GIT_COMMITTED_AT=$GIT_COMMITTED_AT
ENV GIT_TAG=$GIT_TAG

COPY backend/requirements.txt .
# pip pinned (hadolint DL3013) — bump it deliberately, like any other dependency.
# Then removed: the app never runs pip, and pip carries its own vendored copies of
# urllib3/msgpack/setuptools that image scanners flag (and which we can't upgrade).
RUN python -m pip install --no-cache-dir pip==26.2.1 \
    && pip install --no-cache-dir -r requirements.txt \
    && python -m pip uninstall -y pip

COPY backend/app/ ./app/
COPY backend/worker.py .

RUN adduser --disabled-password --no-create-home appuser \
    && chown -R appuser:appuser /app

USER appuser

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health')" || exit 1

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
