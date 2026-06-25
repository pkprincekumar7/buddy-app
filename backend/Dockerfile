FROM python:3.12-slim

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

COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/app/ ./app/
COPY backend/worker.py .

RUN adduser --disabled-password --no-create-home appuser \
    && chown -R appuser:appuser /app

USER appuser

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health')" || exit 1

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
