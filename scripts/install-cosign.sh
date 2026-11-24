#!/usr/bin/env bash
# Installs cosign for the image signing and verification in deploy-live-backend and
# promote-live-backend (production-readiness review, CI-03). Checked against the SHA-256
# GitHub records for the release asset before it's installed (CI-04). v2 keeps signatures
# and attestations as `sha256-<digest>.sig` / `.att` tags, which ECR and crane copy handle.
# Bump the version and the digest together.
# Run: bash scripts/install-cosign.sh   (installs to /usr/local/bin; Linux x86-64 runners)
set -euo pipefail

VERSION="v2.6.5"
SHA256="c3b4f5410e608af03a5eb0aaac84a4313d8da131248e08ff1759ac70c79d1644"
FILE="$(mktemp)"
trap 'rm -f "$FILE"' EXIT

curl -sSfL "https://github.com/sigstore/cosign/releases/download/${VERSION}/cosign-linux-amd64" -o "$FILE"
echo "${SHA256}  ${FILE}" | sha256sum --check --strict
sudo install -m 0755 "$FILE" /usr/local/bin/cosign
cosign version
