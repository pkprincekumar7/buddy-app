# Moto (local SNS, SQS and S3) for docker compose: built here rather than pulled, because
# Docker Desktop's org policy blocks the motoserver/moto image on the team's machines, while
# the Python base image every service builds on is allowed.
#
#   docker compose build moto      (compose builds it on `up`)
#
# The build context is backend/: the Moto version is the one pinned in
# backend/requirements-test.txt (the tests run the same Moto in-process), so the two can't
# drift. Same base image and digest as backend/Dockerfile; bump them together.
FROM python:3.13.18-slim-trixie@sha256:d0a9e379c0c588befb0e427db17ca9731751d281f32c6cb1a90a1277b680bdad

SHELL ["/bin/bash", "-o", "pipefail", "-c"]

COPY requirements-test.txt /tmp/requirements-test.txt

# Only the moto line, so the other test tools don't land in this image. Fails the build if
# it's ever missing from requirements-test.txt.
RUN --mount=type=cache,target=/root/.cache/pip \
    set -eu; \
    export PIP_DEFAULT_TIMEOUT=60 PIP_RETRIES=10; \
    grep -Ex 'moto\[[a-z0-9,]+\]==[0-9.]+' /tmp/requirements-test.txt > /tmp/moto.txt; \
    pip install -r /tmp/moto.txt; \
    rm /tmp/requirements-test.txt /tmp/moto.txt; \
    adduser --disabled-password --no-create-home moto

USER moto
EXPOSE 5000

HEALTHCHECK --interval=5s --timeout=5s --start-period=5s --retries=10 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:5000/moto-api/')" || exit 1

CMD ["moto_server", "-H", "0.0.0.0", "-p", "5000"]
