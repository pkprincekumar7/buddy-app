# One Dockerfile for every backend service (docs/auth-users-split.md, 15.2):
#
#   docker build --build-arg SERVICE=<name> -f backend/Dockerfile .
#
# A service image holds the pinned buddy-common version (with that service's extras) and
# that service's code only, run by `python -m common.serve <name>`: public app on 8000,
# internal app on 8001. SERVICE is required: there is no default image.
#
# The base image is pinned by digest (production-readiness review, CI-03 fix 4, CI-04), so two
# builds of a commit start from the same bytes and the image Trivy scanned is the one deployed.
# Debian security fixes arrive as a new digest of the same tag, which Dependabot proposes
# weekly (.github/dependabot.yml, docker); there's no `apt-get upgrade` here to make builds
# differ. Bump the tag and digest together, both stages.

# ---- select: pick out what the chosen service needs ----------------------------------------
# Throwaway stage: the whole backend/ tree is copied here, but only /out reaches the image.
FROM python:3.13.18-slim-trixie@sha256:d0a9e379c0c588befb0e427db17ca9731751d281f32c6cb1a90a1277b680bdad AS select

ARG SERVICE
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
    [ -n "${SERVICE:-}" ] || { echo "SERVICE is required: --build-arg SERVICE=<name>" >&2; exit 1; }; \
    echo "$SERVICE" | grep -Eqx '[a-z][a-z0-9_]{0,30}' || { echo "invalid SERVICE: $SERVICE" >&2; exit 1; }; \
    [ -d "$SERVICE/app" ] && [ -f "$SERVICE/requirements.txt" ] \
      || { echo "backend/$SERVICE needs app/ and requirements.txt" >&2; exit 1; }; \
    [ "$(grep -cEx 'buddy-common(\[[a-z,]+\])?==[0-9]+\.[0-9]+\.[0-9]+' "$SERVICE/requirements.txt")" = 1 ] \
      || { echo "backend/$SERVICE/requirements.txt needs one buddy-common[extras]==X.Y.Z line" >&2; exit 1; }; \
    cp "$SERVICE/requirements.txt" /out/build/; \
    grep -E '^buddy-common' "$SERVICE/requirements.txt" > /out/build/common.txt; \
    cp -r "$SERVICE" /out/app/; \
    rm -rf "/out/app/$SERVICE/tests"; \
    pip wheel --no-deps --wheel-dir /out/build ./common

# ---- the image -----------------------------------------------------------------------------
FROM python:3.13.18-slim-trixie@sha256:d0a9e379c0c588befb0e427db17ca9731751d281f32c6cb1a90a1277b680bdad

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

# Git metadata baked in at build time — no .git directory or git binary needed.
# CI passes real values via --build-arg; local/scan builds default to "unknown".
ARG GIT_SHA=unknown
ARG GIT_BRANCH=unknown
ARG GIT_COMMITTED_AT=unknown
ARG GIT_TAG=
ENV GIT_SHA=$GIT_SHA
ENV GIT_BRANCH=$GIT_BRANCH
ENV GIT_COMMITTED_AT=$GIT_COMMITTED_AT
ENV GIT_TAG=$GIT_TAG

ARG SERVICE
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
    pip install --no-index --no-deps --find-links /tmp/build -r /tmp/build/common.txt; \
    pip install -r /tmp/build/requirements.txt; \
    python -m pip uninstall -y pip; \
    rm -rf /tmp/build

COPY --from=select /out/app/ ./

RUN adduser --disabled-password --no-create-home appuser \
    && chown -R appuser:appuser /app

USER appuser

# 8000: the public app; 8001: the internal one (common.serve).
EXPOSE 8000 8001

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health')" || exit 1

CMD ["/bin/sh", "-c", "exec python -m common.serve \"$SERVICE\""]
