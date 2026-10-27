# One Dockerfile for every backend service (docs/auth-users-split.md, 15.2):
#
#   docker build --build-arg SERVICE=<name> -f backend/Dockerfile .
#
# A service image holds the pinned buddy-common version (with that service's extras) and
# that service's code only, run by `python -m common.serve <name>`: public app on 8000,
# internal app on 8001. SERVICE=backend, the default, builds today's single app as before,
# until it's removed in build plan 8.6.

# ---- select: pick out what the chosen service needs ----------------------------------------
# Throwaway stage: the whole backend/ tree is copied here, but only /out reaches the image.
FROM python:3.13-slim AS select

ARG SERVICE=backend
WORKDIR /src
COPY backend/ ./

SHELL ["/bin/bash", "-o", "pipefail", "-c"]

# A service declares its common version on one `buddy-common[extras]==X.Y.Z` line in its
# requirements.txt. The wheel is built from this tree's backend/common; the final stage
# installs that line from the wheel only, never from PyPI (no dependency confusion).
# Building the wheel fetches its build backend (setuptools) from PyPI: through the same pip
# cache and patience as the install below.
RUN --mount=type=cache,target=/root/.cache/pip \
    set -eu; \
    export PIP_DEFAULT_TIMEOUT=60 PIP_RETRIES=10; \
    mkdir -p /out/app /out/build; \
    if [ "$SERVICE" = backend ]; then \
      cp requirements.txt /out/build/; \
      cp -r app worker.py /out/app/; \
    else \
      echo "$SERVICE" | grep -Eqx '[a-z][a-z0-9_]{0,30}' || { echo "invalid SERVICE: $SERVICE" >&2; exit 1; }; \
      [ -d "$SERVICE/app" ] && [ -f "$SERVICE/requirements.txt" ] \
        || { echo "backend/$SERVICE needs app/ and requirements.txt" >&2; exit 1; }; \
      [ "$(grep -cEx 'buddy-common(\[[a-z,]+\])?==[0-9]+\.[0-9]+\.[0-9]+' "$SERVICE/requirements.txt")" = 1 ] \
        || { echo "backend/$SERVICE/requirements.txt needs one buddy-common[extras]==X.Y.Z line" >&2; exit 1; }; \
      cp "$SERVICE/requirements.txt" /out/build/; \
      grep -E '^buddy-common' "$SERVICE/requirements.txt" > /out/build/common.txt; \
      cp -r "$SERVICE" /out/app/; \
      rm -rf "/out/app/$SERVICE/tests"; \
      pip wheel --no-deps --wheel-dir /out/build ./common; \
    fi

# ---- the image -----------------------------------------------------------------------------
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

ARG SERVICE=backend
ENV SERVICE=$SERVICE

COPY --from=select /out/build/ /tmp/build/
# pip pinned (hadolint DL3013) — bump it deliberately, like any other dependency.
# Then removed: the app never runs pip, and pip carries its own vendored copies of
# urllib3/msgpack/setuptools that image scanners flag (and which we can't upgrade).
#
# Downloads go to a BuildKit cache mount, shared by every service's build and kept between
# builds, but never part of the image (so no --no-cache-dir: the cache isn't in a layer).
# A package is downloaded once for all the images, and a build that fails part-way keeps
# what it fetched. A longer timeout and more retries ride out a slow link to PyPI.
RUN --mount=type=cache,target=/root/.cache/pip \
    set -eu; \
    export PIP_DEFAULT_TIMEOUT=60 PIP_RETRIES=10; \
    python -m pip install pip==26.2.1; \
    if [ -f /tmp/build/common.txt ]; then \
      pip install --no-index --no-deps --find-links /tmp/build -r /tmp/build/common.txt; \
    fi; \
    pip install -r /tmp/build/requirements.txt; \
    python -m pip uninstall -y pip; \
    rm -rf /tmp/build

COPY --from=select /out/app/ ./

RUN adduser --disabled-password --no-create-home appuser \
    && chown -R appuser:appuser /app

USER appuser

# 8001 is the internal port; today's backend (SERVICE=backend) serves 8000 only.
EXPOSE 8000 8001

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health')" || exit 1

CMD ["/bin/sh", "-c", "if [ \"$SERVICE\" = backend ]; then exec uvicorn app.main:app --host 0.0.0.0 --port 8000; else exec python -m common.serve \"$SERVICE\"; fi"]
