#!/bin/bash
set -euo pipefail

cd -- "$(dirname -- "${BASH_SOURCE[0]}")"

# Prefer the project's pinned nvm runtime when it is already installed.
nvm_root="${NVM_DIR:-$HOME/.nvm}"
pinned_node="$nvm_root/versions/node/v$(cat .node-version)/bin/node"
if [[ -x "$pinned_node" ]]; then
  export PATH="$(dirname -- "$pinned_node"):$PATH"
fi

node_is_supported() {
  "$1" -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 22 ? 0 : 1)' >/dev/null 2>&1
} 2>/dev/null

if ! node_is_supported node; then
  found_node=false
  for candidate in "$nvm_root"/versions/node/v*/bin/node; do
    if [[ -x "$candidate" ]] && node_is_supported "$candidate"; then
      export PATH="$(dirname -- "$candidate"):$PATH"
      found_node=true
      break
    fi
  done
  if [[ "$found_node" != true ]]; then
    echo "Install Node 22 or newer, then run this command again." >&2
    exit 1
  fi
fi

case "${1:-preview}" in
  preview)
    exec npm run quartz -- build --serve
    ;;
  build)
    exec npm run quartz -- build
    ;;
  publish)
    npm run quartz -- build
    node scripts/publish-portfolio.mjs
    ;;
  *)
    echo "Usage: bash portfolio.sh [preview|build|publish]" >&2
    exit 2
    ;;
esac
