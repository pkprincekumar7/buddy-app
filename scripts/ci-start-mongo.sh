#!/usr/bin/env bash
# Starts MongoDB 8.0 as a single-node replica set on localhost:27017 and waits until it's
# primary (CI: check.yml). Not a service container: those can't pass --replSet, and change
# streams and transactions need a replica set. Same image, flags and environment as
# docker-compose.yml, which explains GLIBC_TUNABLES.
set -euo pipefail

docker run -d --name mongo -p 27017:27017 -e GLIBC_TUNABLES=glibc.pthread.rseq=1 mongo:8.0.38@sha256:479e85ced54ffb8a40dade1dcde2da2a9ae858515b9415e9cc54bfb8f0575d01 --replSet rs0 --bind_ip_all
# mongosh with HOME=/tmp: the image's HOME is /data/db, which the entrypoint chowns on first
# start, and mongosh's own lock files appearing and going there mid-chown make it exit.
for _ in $(seq 1 30); do
  if docker exec -e HOME=/tmp mongo mongosh --quiet --eval \
    "try { rs.status().ok } catch (e) { rs.initiate({_id: 'rs0', members: [{_id: 0, host: 'localhost:27017'}]}).ok }; db.hello().isWritablePrimary" \
    2>/dev/null | grep -q true; then
    exit 0
  fi
  sleep 2
done
echo "MongoDB replica set didn't become primary"
docker logs mongo
exit 1
