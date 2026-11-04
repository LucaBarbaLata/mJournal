#!/usr/bin/env bash
# Downloads the Node.js version used to build mJournal into .tools/node (Linux x64).
# The archive is checked against the official SHA-256 checksum before use.
# Linux counterpart of get-node.ps1; keep the two versions the same.
set -euo pipefail

version='v24.21.0'
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
tools="$root/.tools"
target="$tools/node"
[ -x "$target/bin/node" ] && exit 0

if [ "$(uname -m)" != "x86_64" ]; then
  echo "  mJournal is built for 64-bit Intel/AMD computers (x86_64); this one is $(uname -m)." >&2
  exit 1
fi

fetch() {
  if command -v curl >/dev/null 2>&1; then curl -fsSL "$1" -o "$2"
  elif command -v wget >/dev/null 2>&1; then wget -q "$1" -O "$2"
  else echo "  Neither curl nor wget is installed, so Node.js can't be downloaded." >&2; exit 1
  fi
}

mkdir -p "$tools"
name="node-$version-linux-x64"
archive="$tools/$name.tar.xz"
echo "  Downloading Node.js $version from nodejs.org..."
fetch "https://nodejs.org/dist/$version/$name.tar.xz" "$archive"
fetch "https://nodejs.org/dist/$version/SHASUMS256.txt" "$tools/SHASUMS256.txt"
expected="$(awk -v f="$name.tar.xz" '$2 == f { print $1 }' "$tools/SHASUMS256.txt")"
actual="$(sha256sum "$archive" | cut -d' ' -f1)"
rm -f "$tools/SHASUMS256.txt"
if [ -z "$expected" ] || [ "$expected" != "$actual" ]; then
  rm -f "$archive"
  echo "  The Node.js download did not match its published checksum, so it was not used." >&2
  exit 1
fi
tar -xJf "$archive" -C "$tools"
rm -rf "$target" # a broken earlier copy
mv "$tools/$name" "$target"
rm -f "$archive"
echo "  Node.js is ready in .tools/node"
