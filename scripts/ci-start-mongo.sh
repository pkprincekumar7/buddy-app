#!/usr/bin/env bash
# Starts MongoDB 8.0 as a single-node replica set on localhost:27017 and waits until it's
# primary (CI: check.yml). Not a service container: those can't pass --replSet, and change
# streams and transactions need a replica set. Same image and flags as docker-compose.yml.
set -euo pipefail

docker run -d --name mongo -p 27017:27017 mongo:8.0.34 --replSet rs0 --bind_ip_all
for _ in $(seq 1 30); do
  if docker exec mongo mongosh --quiet --eval \
    "try { rs.status().ok } catch (e) { rs.initiate({_id: 'rs0', members: [{_id: 0, host: 'localhost:27017'}]}).ok }; db.hello().isWritablePrimary" \
    2>/dev/null | grep -q true; then
    exit 0
  fi
  sleep 2
done
echo "MongoDB replica set didn't become primary"
docker logs mongo
exit 1
