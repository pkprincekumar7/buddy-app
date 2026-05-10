FROM python:3.12-slim

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app/ ./app/
COPY alembic/ ./alembic/
COPY alembic.ini .

RUN adduser --disabled-password --no-create-home appuser \
    && chown -R appuser:appuser /app

USER appuser

EXPOSE 8000

# Startup sequence:
#   1. alembic upgrade head          — apply regional/single-instance schema
#   2. alembic -x db=router ...      — apply router schema (only when ROUTER_DB_URL is set)
#   3. uvicorn                        — start the API server
#
# MULTI-REGION / AURORA GLOBAL DATABASE NOTE
# ------------------------------------------
# Aurora Global Database has a single writer endpoint (primary region) and
# read-only reader endpoints in secondary regions.  Attempting DDL writes
# against a read-only replica fails with "read-only transaction".
#
# Step 1 (regional migration):
#   Set REGIONAL_DB_SKIP_MIGRATION=true in secondary-region task definitions.
#   Run `alembic upgrade head` ONCE from the primary region (or as a one-off
#   migration job) before your first deployment.
#
# Step 2 (router migration):
#   Set ROUTER_DB_URL_SKIP_MIGRATION=true in secondary-region task definitions.
#   Run the router migration ONCE from the primary region, or point ROUTER_DB_URL
#   at the Aurora Global cluster writer endpoint (cross-region writes are
#   forwarded automatically, with ~100 ms extra latency per saga write).
#
# If ROUTER_DB_URL is not set, step 2 is skipped entirely (single-instance mode).
CMD ["sh", "-c", \
  "([ -n \"$REGIONAL_DB_SKIP_MIGRATION\" ] || alembic upgrade head) && \
   ([ -z \"$ROUTER_DB_URL\" ] || [ -n \"$ROUTER_DB_URL_SKIP_MIGRATION\" ] || alembic -x db=router upgrade head) && \
   uvicorn app.main:app --host 0.0.0.0 --port 8000"]
