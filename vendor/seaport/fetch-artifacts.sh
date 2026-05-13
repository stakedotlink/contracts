#!/usr/bin/env bash
# Fetches Seaport 1.6 + ConduitController compiled artifacts and writes them
# to ./Seaport.json and ./ConduitController.json next to this script.
#
# Run once per developer machine. Re-run if you bump the SEAPORT_TAG.
#
# Requires: git, forge (foundry), jq.

set -euo pipefail

SEAPORT_TAG="1.6"
SEAPORT_REPO="https://github.com/ProjectOpenSea/seaport.git"
VENDOR_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TMP_DIR="$(mktemp -d)"

trap 'rm -rf "$TMP_DIR"' EXIT

echo "Cloning Seaport @ $SEAPORT_TAG into $TMP_DIR..."
git clone --depth 1 --branch "$SEAPORT_TAG" "$SEAPORT_REPO" "$TMP_DIR/seaport"

echo "Building with forge..."
cd "$TMP_DIR/seaport"
forge build --silent

echo "Extracting Seaport artifact..."
jq '{abi, bytecode: .bytecode.object}' \
  "$TMP_DIR/seaport/out/Seaport.sol/Seaport.json" \
  > "$VENDOR_DIR/Seaport.json"

echo "Extracting ConduitController artifact..."
jq '{abi, bytecode: .bytecode.object}' \
  "$TMP_DIR/seaport/out/ConduitController.sol/ConduitController.json" \
  > "$VENDOR_DIR/ConduitController.json"

echo "Done. Vendored:"
ls -la "$VENDOR_DIR"/*.json
