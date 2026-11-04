#!/usr/bin/env bash
# Builds mJournal for Linux from source: run   bash build-mjournal.sh   in this folder.
# Result: release/mjournal_<version>_amd64.deb and release/mJournal-<version>.AppImage
# Linux counterpart of "Build mJournal.cmd".
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
unset ELECTRON_RUN_AS_NODE

fail() {
  echo
  echo "  The build did not finish. Scroll up to see what went wrong,"
  echo "  or see \"Troubleshooting\" in README.md."
  exit 1
}
trap fail ERR

echo
echo "  mJournal - building the app. The first build downloads about 300 MB"
echo "  of tools and can take a few minutes."
echo

# Node.js 22.12 or newer. Ubuntu-based systems ship an older one, so a private copy
# is downloaded into .tools/ when needed (nothing is installed system-wide).
node_is_recent() {
  command -v node >/dev/null 2>&1 &&
    node -e 'const [a, b] = process.versions.node.split(".").map(Number); process.exit(a > 22 || (a === 22 && b >= 12) ? 0 : 1)'
}
if [ -x ".tools/node/bin/node" ]; then
  export PATH="$PWD/.tools/node/bin:$PATH"
elif ! node_is_recent; then
  echo "  Node.js 22.12 or newer was not found, so a private copy will be downloaded into .tools/"
  bash scripts/get-node.sh
  export PATH="$PWD/.tools/node/bin:$PATH"
fi

echo "  [1/3] Installing dependencies..."
npm ci --no-audit --no-fund
node node_modules/electron/install.js

echo "  [2/3] Building mJournal..."
npm run dist:linux

echo
echo "  [3/3] Done! In the \"release\" folder you will find:"
echo "    mjournal_*_amd64.deb     installs mJournal into the app menu (Ubuntu, Zorin OS, Mint, Debian...)"
echo "    mJournal-*.AppImage      runs mJournal without installing"
echo
# MJOURNAL_BUILD_UNATTENDED=1 skips opening the folder (for automated builds).
if [ -z "${MJOURNAL_BUILD_UNATTENDED:-}" ] && command -v xdg-open >/dev/null 2>&1; then
  xdg-open release >/dev/null 2>&1 || true
fi
